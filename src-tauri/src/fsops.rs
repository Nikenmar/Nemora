//! Crash-safe filesystem primitives.
//!
//! OWNER: agent "rust-fsops". Other agents must not edit this file.
//!
//! Why this exists: `tauri-plugin-fs` has no atomic replace and no fsync
//! (docs/tauri-port/03-main-logic-port.md). Every store write and every tag
//! write in Nora must survive a crash or power loss with either the complete
//! old file or the complete new one - never a truncated mix. That guarantee is
//! goal #1 of the port, so it lives in Rust rather than in the webview.

use serde::Serialize;
use std::{
    ffi::OsString,
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const READ_CHUNK_SIZE: usize = 64 * 1024;
const MAX_TEMP_ATTEMPTS: usize = 128;
static NEXT_TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum FsOpsErrorCode {
    AtomicInvalidPath,
    AtomicParent,
    AtomicTempCreate,
    AtomicTempExhausted,
    AtomicTempWrite,
    AtomicTempFlush,
    AtomicTempSync,
    AtomicReplace,
    #[cfg(unix)]
    AtomicDirectorySync,
    ReadOpen,
    ReadIo,
    ReadAllocation,
    CapacityInvalidPath,
    CapacityResolvePath,
    CapacityQuery,
    #[cfg(unix)]
    CapacityOverflow,
    TaskJoin,
}

impl FsOpsErrorCode {
    fn as_str(self) -> &'static str {
        match self {
            Self::AtomicInvalidPath => "FS_ATOMIC_INVALID_PATH",
            Self::AtomicParent => "FS_ATOMIC_PARENT",
            Self::AtomicTempCreate => "FS_ATOMIC_TEMP_CREATE",
            Self::AtomicTempExhausted => "FS_ATOMIC_TEMP_EXHAUSTED",
            Self::AtomicTempWrite => "FS_ATOMIC_TEMP_WRITE",
            Self::AtomicTempFlush => "FS_ATOMIC_TEMP_FLUSH",
            Self::AtomicTempSync => "FS_ATOMIC_TEMP_SYNC",
            Self::AtomicReplace => "FS_ATOMIC_REPLACE",
            #[cfg(unix)]
            Self::AtomicDirectorySync => "FS_ATOMIC_DIRECTORY_SYNC",
            Self::ReadOpen => "FS_READ_OPEN",
            Self::ReadIo => "FS_READ_IO",
            Self::ReadAllocation => "FS_READ_ALLOCATION",
            Self::CapacityInvalidPath => "FS_CAPACITY_INVALID_PATH",
            Self::CapacityResolvePath => "FS_CAPACITY_RESOLVE_PATH",
            Self::CapacityQuery => "FS_CAPACITY_QUERY",
            #[cfg(unix)]
            Self::CapacityOverflow => "FS_CAPACITY_OVERFLOW",
            Self::TaskJoin => "FS_TASK_JOIN",
        }
    }
}

#[derive(Debug)]
pub(crate) struct FsOpsError {
    code: FsOpsErrorCode,
    path: PathBuf,
    detail: String,
}

impl FsOpsError {
    fn new(code: FsOpsErrorCode, path: impl Into<PathBuf>, detail: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            detail: detail.into(),
        }
    }

    fn io(code: FsOpsErrorCode, path: impl Into<PathBuf>, error: io::Error) -> Self {
        Self::new(code, path, error.to_string())
    }
}

impl fmt::Display for FsOpsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} [{}]: {}",
            self.code.as_str(),
            self.path.display(),
            self.detail
        )
    }
}

impl std::error::Error for FsOpsError {}

struct PendingTemp {
    path: PathBuf,
    file: Option<File>,
    armed: bool,
}

impl PendingTemp {
    fn create(directory: &Path) -> Result<Self, FsOpsError> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);

        for _ in 0..MAX_TEMP_ATTEMPTS {
            let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
            let name = OsString::from(format!(".nora-tmp-{}-{timestamp}-{id}", std::process::id()));
            let path = directory.join(name);

            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => {
                    return Ok(Self {
                        path,
                        file: Some(file),
                        armed: true,
                    });
                }
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => {
                    return Err(FsOpsError::io(
                        FsOpsErrorCode::AtomicTempCreate,
                        path,
                        error,
                    ));
                }
            }
        }

        Err(FsOpsError::new(
            FsOpsErrorCode::AtomicTempExhausted,
            directory,
            format!("could not reserve a temp name after {MAX_TEMP_ATTEMPTS} attempts"),
        ))
    }

    fn write_and_sync(&mut self, contents: &[u8]) -> Result<(), FsOpsError> {
        let file = self.file.as_mut().ok_or_else(|| {
            FsOpsError::new(
                FsOpsErrorCode::AtomicTempWrite,
                &self.path,
                "temporary file handle is already closed",
            )
        })?;

        file.write_all(contents)
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicTempWrite, &self.path, error))?;
        file.flush()
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicTempFlush, &self.path, error))?;
        file.sync_all()
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicTempSync, &self.path, error))
    }

    fn close(&mut self) {
        self.file.take();
    }

    fn mark_replaced(&mut self) {
        self.armed = false;
    }
}

impl Drop for PendingTemp {
    fn drop(&mut self) {
        // Windows will not unlink an open file, so close the handle first.
        self.file.take();
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Writes `contents` to `path` so that a crash leaves either the previous file
/// intact or the new file complete.
///
/// The temporary file is created in the destination directory, made durable,
/// and then atomically installed. Windows uses `ReplaceFileW` for an existing
/// destination so its metadata is preserved.
#[tauri::command]
pub async fn write_file_atomic(path: String, contents: Vec<u8>) -> Result<(), String> {
    let error_path = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || {
        write_file_atomic_impl(Path::new(&path), &contents)
    })
    .await
    .map_err(|error| {
        FsOpsError::new(FsOpsErrorCode::TaskJoin, error_path, error.to_string()).to_string()
    })?
    .map_err(|error| error.to_string())
}

/// Atomically writes UTF-8 text without expanding it into a JSON array of
/// byte values at the IPC boundary. Store callers should use this command;
/// binary artwork and tag writers should use `write_file_atomic`.
#[tauri::command]
pub async fn write_text_file_atomic(path: String, contents: String) -> Result<(), String> {
    let error_path = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || {
        write_file_atomic_impl(Path::new(&path), contents.as_bytes())
    })
    .await
    .map_err(|error| {
        FsOpsError::new(FsOpsErrorCode::TaskJoin, error_path, error.to_string()).to_string()
    })?
    .map_err(|error| error.to_string())
}

/// Atomically installs a copy of `source` at `destination`, without the bytes
/// ever crossing the IPC boundary.
///
/// This is the right command whenever the data already exists on disk, such as
/// artwork the user picked from a folder. Sending those bytes up into the
/// webview only to send them back down would cost two JSON-array trips for no
/// benefit; `write_file_atomic` is for bytes the webview genuinely generated,
/// like a canvas-resized thumbnail.
#[tauri::command]
pub async fn copy_file_atomic(source: String, destination: String) -> Result<(), String> {
    let error_path = PathBuf::from(&destination);
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = File::open(Path::new(&source))
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::ReadOpen, &source, error))?;
        let mut contents = Vec::new();
        file.read_to_end(&mut contents)
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::ReadIo, &source, error))?;
        write_file_atomic_impl(Path::new(&destination), &contents)
    })
    .await
    .map_err(|error| {
        FsOpsError::new(FsOpsErrorCode::TaskJoin, error_path, error.to_string()).to_string()
    })?
    .map_err(|error| error.to_string())
}

pub(crate) fn write_file_atomic_impl(path: &Path, contents: &[u8]) -> Result<(), FsOpsError> {
    let (destination, directory) = atomic_destination(path)?;
    let mut temp = PendingTemp::create(&directory)?;
    temp.write_and_sync(contents)?;
    temp.close();

    atomic_replace(&temp.path, &destination)?;
    temp.mark_replaced();
    sync_directory(&directory)
}

fn atomic_destination(path: &Path) -> Result<(PathBuf, PathBuf), FsOpsError> {
    let file_name = path.file_name().ok_or_else(|| {
        FsOpsError::new(
            FsOpsErrorCode::AtomicInvalidPath,
            path,
            "destination must include a file name",
        )
    })?;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let parent = if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    };
    // Create the parent before canonicalizing, because canonicalize fails on a
    // path that does not exist yet.
    //
    // On a FIRST RUN nothing has created %APPDATA%\Nemora, so every store write
    // failed here and the profile could never be written at all. It went
    // unnoticed because every test run pointed at a sandbox directory that had
    // already been created by hand, so the one path a real install takes was
    // the one path never exercised.
    //
    // Doing it here rather than at startup covers every caller: stores,
    // artwork, the import's backup folder, and anything added later.
    if !parent.exists() {
        fs::create_dir_all(parent)
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicParent, parent, error))?;
    }
    let directory = fs::canonicalize(parent)
        .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicParent, parent, error))?;
    let metadata = fs::metadata(&directory)
        .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicParent, &directory, error))?;
    if !metadata.is_dir() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::AtomicParent,
            &directory,
            "destination parent is not a directory",
        ));
    }

    Ok((directory.join(file_name), directory))
}

#[cfg(windows)]
fn atomic_replace(temp: &Path, destination: &Path) -> Result<(), FsOpsError> {
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH, REPLACE_FILE_FLAGS,
        },
    };

    let temp_wide = wide_path(temp)?;
    let destination_wide = wide_path(destination)?;
    let temp_pcwstr = PCWSTR::from_raw(temp_wide.as_ptr());
    let destination_pcwstr = PCWSTR::from_raw(destination_wide.as_ptr());

    let destination_exists = match fs::symlink_metadata(destination) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => {
            return Err(FsOpsError::io(
                FsOpsErrorCode::AtomicReplace,
                destination,
                error,
            ));
        }
    };

    let result = if destination_exists {
        // SAFETY: all PCWSTR values point to live, NUL-terminated buffers for
        // the duration of the call. The temp handle has already been closed.
        unsafe {
            ReplaceFileW(
                destination_pcwstr,
                temp_pcwstr,
                PCWSTR::null(),
                REPLACE_FILE_FLAGS(0),
                None,
                None,
            )
        }
    } else {
        // No replacement metadata exists to preserve. Omitting
        // MOVEFILE_REPLACE_EXISTING also makes a concurrent creator fail
        // closed instead of being overwritten.
        // SAFETY: both PCWSTR values are valid as described above.
        unsafe { MoveFileExW(temp_pcwstr, destination_pcwstr, MOVEFILE_WRITE_THROUGH) }
    };

    result.map_err(|error| {
        FsOpsError::new(
            FsOpsErrorCode::AtomicReplace,
            destination,
            error.to_string(),
        )
    })
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Result<Vec<u16>, FsOpsError> {
    use std::os::windows::ffi::OsStrExt;

    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err(FsOpsError::new(
            FsOpsErrorCode::AtomicInvalidPath,
            path,
            "path contains an interior NUL",
        ));
    }
    wide.push(0);
    Ok(wide)
}

#[cfg(not(windows))]
fn atomic_replace(temp: &Path, destination: &Path) -> Result<(), FsOpsError> {
    fs::rename(temp, destination)
        .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicReplace, destination, error))
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> Result<(), FsOpsError> {
    let handle = File::open(directory)
        .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicDirectorySync, directory, error))?;
    handle
        .sync_all()
        .map_err(|error| FsOpsError::io(FsOpsErrorCode::AtomicDirectorySync, directory, error))
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> Result<(), FsOpsError> {
    // Windows does not expose a supported equivalent of fsync for a directory
    // handle. The temp file itself was synced before ReplaceFileW/MoveFileExW.
    Ok(())
}

/// Reads the first `len` bytes of a file. Used by the library scanner, which
/// must never read whole 18 MB tracks just to parse their tags.
#[tauri::command]
pub async fn read_head(path: String, len: u64) -> Result<tauri::ipc::Response, String> {
    let error_path = PathBuf::from(&path);
    let bytes = tauri::async_runtime::spawn_blocking(move || read_head_impl(Path::new(&path), len))
        .await
        .map_err(|error| {
            FsOpsError::new(FsOpsErrorCode::TaskJoin, error_path, error.to_string()).to_string()
        })?
        .map_err(|error| error.to_string())?;

    // Response::new(Vec<u8>) becomes InvokeResponseBody::Raw. Returning the
    // Vec directly would serialize it as a JSON array of numbers.
    Ok(tauri::ipc::Response::new(bytes))
}

fn read_head_impl(path: &Path, len: u64) -> Result<Vec<u8>, FsOpsError> {
    let mut file =
        File::open(path).map_err(|error| FsOpsError::io(FsOpsErrorCode::ReadOpen, path, error))?;
    let mut bytes = Vec::new();
    let mut remaining = len;
    let mut chunk = [0_u8; READ_CHUNK_SIZE];

    while remaining > 0 {
        let requested = remaining.min(READ_CHUNK_SIZE as u64) as usize;
        let read = match file.read(&mut chunk[..requested]) {
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(FsOpsError::io(FsOpsErrorCode::ReadIo, path, error)),
        };
        if read == 0 {
            break;
        }
        bytes.try_reserve(read).map_err(|error| {
            FsOpsError::new(FsOpsErrorCode::ReadAllocation, path, error.to_string())
        })?;
        bytes.extend_from_slice(&chunk[..read]);
        remaining -= read as u64;
    }

    Ok(bytes)
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct DiskCapacity {
    pub total_bytes: u64,
    pub free_bytes: u64,
}

/// Replaces `src/main/utils/getRootSize.ts`, which shells out to PowerShell.
#[tauri::command]
pub async fn disk_capacity(path: String) -> Result<DiskCapacity, String> {
    let error_path = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || disk_capacity_impl(Path::new(&path)))
        .await
        .map_err(|error| {
            FsOpsError::new(FsOpsErrorCode::TaskJoin, error_path, error.to_string()).to_string()
        })?
        .map_err(|error| error.to_string())
}

fn disk_capacity_impl(path: &Path) -> Result<DiskCapacity, FsOpsError> {
    let directory = existing_directory(path)?;
    platform_disk_capacity(&directory)
}

fn existing_directory(path: &Path) -> Result<PathBuf, FsOpsError> {
    if path.as_os_str().is_empty() {
        return Err(FsOpsError::new(
            FsOpsErrorCode::CapacityInvalidPath,
            path,
            "path must not be empty",
        ));
    }

    let mut candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| FsOpsError::io(FsOpsErrorCode::CapacityResolvePath, path, error))?
            .join(path)
    };

    loop {
        match fs::metadata(&candidate) {
            Ok(metadata) if metadata.is_dir() => return Ok(candidate),
            Ok(_) => {
                if !candidate.pop() {
                    break;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if !candidate.pop() {
                    break;
                }
            }
            Err(error) => {
                return Err(FsOpsError::io(
                    FsOpsErrorCode::CapacityResolvePath,
                    &candidate,
                    error,
                ));
            }
        }
    }

    Err(FsOpsError::new(
        FsOpsErrorCode::CapacityResolvePath,
        path,
        "no existing containing directory was found",
    ))
}

#[cfg(windows)]
fn platform_disk_capacity(directory: &Path) -> Result<DiskCapacity, FsOpsError> {
    use windows::{core::PCWSTR, Win32::Storage::FileSystem::GetDiskFreeSpaceExW};

    let wide = wide_path(directory).map_err(|error| {
        FsOpsError::new(FsOpsErrorCode::CapacityInvalidPath, directory, error.detail)
    })?;
    let mut total_bytes = 0_u64;
    let mut free_bytes_available = 0_u64;

    // SAFETY: the path buffer is NUL-terminated and remains live for the call;
    // both output pointers refer to initialized u64 values.
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR::from_raw(wide.as_ptr()),
            Some(&mut free_bytes_available),
            Some(&mut total_bytes),
            None,
        )
    }
    .map_err(|error| {
        FsOpsError::new(FsOpsErrorCode::CapacityQuery, directory, error.to_string())
    })?;

    Ok(DiskCapacity {
        total_bytes,
        // Match `df`'s available column and report space this process can
        // actually write when per-user disk quotas are active.
        free_bytes: free_bytes_available,
    })
}

#[cfg(unix)]
fn platform_disk_capacity(directory: &Path) -> Result<DiskCapacity, FsOpsError> {
    use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};

    let path = CString::new(directory.as_os_str().as_bytes()).map_err(|_| {
        FsOpsError::new(
            FsOpsErrorCode::CapacityInvalidPath,
            directory,
            "path contains an interior NUL",
        )
    })?;
    let mut stats = MaybeUninit::<libc::statvfs>::uninit();

    // SAFETY: `path` is NUL-terminated and `stats` points to writable storage
    // for a statvfs structure. A zero return value guarantees initialization.
    if unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) } != 0 {
        return Err(FsOpsError::io(
            FsOpsErrorCode::CapacityQuery,
            directory,
            io::Error::last_os_error(),
        ));
    }
    // SAFETY: statvfs succeeded and initialized the complete structure.
    let stats = unsafe { stats.assume_init() };
    let block_size = if stats.f_frsize == 0 {
        stats.f_bsize as u128
    } else {
        stats.f_frsize as u128
    };
    let total_bytes = checked_capacity_product(stats.f_blocks as u128, block_size, directory)?;
    // f_bavail, unlike f_bfree, excludes blocks reserved from this process.
    let free_bytes = checked_capacity_product(stats.f_bavail as u128, block_size, directory)?;

    Ok(DiskCapacity {
        total_bytes,
        free_bytes,
    })
}

#[cfg(unix)]
fn checked_capacity_product(
    blocks: u128,
    block_size: u128,
    path: &Path,
) -> Result<u64, FsOpsError> {
    blocks
        .checked_mul(block_size)
        .and_then(|bytes| u64::try_from(bytes).ok())
        .ok_or_else(|| {
            FsOpsError::new(
                FsOpsErrorCode::CapacityOverflow,
                path,
                "filesystem capacity does not fit in u64 bytes",
            )
        })
}

#[cfg(not(any(windows, unix)))]
fn platform_disk_capacity(directory: &Path) -> Result<DiskCapacity, FsOpsError> {
    Err(FsOpsError::new(
        FsOpsErrorCode::CapacityQuery,
        directory,
        "disk capacity is not supported on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn create() -> Self {
            let root = std::env::temp_dir();
            loop {
                let id = NEXT_TEMP_ID.fetch_add(1, Ordering::Relaxed);
                let path = root.join(format!("nora-fsops-test-{}-{id}", std::process::id()));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("failed to create test directory: {error}"),
                }
            }
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_artifacts(directory: &Path) -> Vec<PathBuf> {
        fs::read_dir(directory)
            .expect("test directory should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(".nora-tmp-"))
            })
            .collect()
    }

    #[test]
    fn atomic_write_creates_and_replaces_with_complete_contents() {
        let directory = TestDirectory::create();
        let destination = directory.path().join("store.json");

        write_file_atomic_impl(&destination, br#"{"version":1}"#)
            .expect("initial atomic write should succeed");
        assert_eq!(
            fs::read(&destination).expect("destination should be readable"),
            br#"{"version":1}"#
        );

        write_file_atomic_impl(&destination, br#"{"version":2,"complete":true}"#)
            .expect("replacement atomic write should succeed");
        assert_eq!(
            fs::read(&destination).expect("destination should be readable"),
            br#"{"version":2,"complete":true}"#
        );
        assert!(temp_artifacts(directory.path()).is_empty());
    }

    #[test]
    fn atomic_write_creates_a_missing_profile_directory() {
        // The first run of a real install: %APPDATA%\Nemora does not exist yet,
        // and the very first store write has to make it. This shipped broken in
        // 1.0.0-stable because every test pointed at a directory created by
        // hand beforehand, so nothing could write a profile after installing.
        let directory = TestDirectory::create();
        let destination = directory
            .path()
            .join("Nemora")
            .join("nested")
            .join("userData.json");

        write_file_atomic_impl(&destination, br#"{"userData":{}}"#)
            .expect("a write into a missing directory should create it");

        assert_eq!(
            fs::read(&destination).expect("destination should be readable"),
            br#"{"userData":{}}"#
        );
        assert!(temp_artifacts(destination.parent().unwrap()).is_empty());
    }

    #[test]
    fn atomic_write_removes_temp_file_when_replace_fails() {
        let directory = TestDirectory::create();
        let destination = directory.path().join("destination-is-a-directory");
        fs::create_dir(&destination).expect("destination directory should be created");

        let error = write_file_atomic_impl(&destination, b"new data")
            .expect_err("replacing a directory must fail");

        assert_eq!(error.code, FsOpsErrorCode::AtomicReplace);
        assert!(destination.is_dir());
        assert!(temp_artifacts(directory.path()).is_empty());
    }

    #[test]
    fn atomic_write_preserves_utf8_text_bytes() {
        let directory = TestDirectory::create();
        let destination = directory.path().join("unicode.json");
        let contents = r#"{"artist":"Один в каное","marker":"☆"}"#;

        write_file_atomic_impl(&destination, contents.as_bytes())
            .expect("UTF-8 atomic write should succeed");

        assert_eq!(
            fs::read_to_string(&destination).expect("destination should contain UTF-8"),
            contents
        );
    }

    #[test]
    fn read_head_is_bounded_and_accepts_short_files() {
        let directory = TestDirectory::create();
        let path = directory.path().join("audio.flac");
        fs::write(&path, [1_u8, 2, 3, 4, 5]).expect("fixture should be written");

        assert_eq!(
            read_head_impl(&path, 3).expect("bounded read should succeed"),
            vec![1, 2, 3]
        );
        assert_eq!(
            read_head_impl(&path, 100).expect("short read should succeed"),
            vec![1, 2, 3, 4, 5]
        );
        assert!(read_head_impl(&path, 0)
            .expect("zero-length read should succeed")
            .is_empty());
    }

    #[test]
    fn tauri_response_wraps_bytes_as_raw_ipc() {
        let response = tauri::ipc::Response::new(vec![1_u8, 2, 3]);
        let body = response.body().expect("response body should resolve");

        assert!(matches!(body, InvokeResponseBody::Raw(bytes) if bytes == [1, 2, 3]));
    }

    #[test]
    fn errors_include_a_stable_type_code() {
        let directory = TestDirectory::create();
        let missing = directory.path().join("missing.flac");
        let error = read_head_impl(&missing, 16).expect_err("missing file must fail");

        assert_eq!(error.code, FsOpsErrorCode::ReadOpen);
        assert!(error.to_string().starts_with("FS_READ_OPEN ["));
    }

    #[test]
    fn disk_capacity_uses_the_volume_of_the_nearest_existing_ancestor() {
        let directory = TestDirectory::create();
        let nonexistent = directory.path().join("future").join("store.json");

        let capacity = disk_capacity_impl(&nonexistent).expect("capacity query should succeed");

        assert!(capacity.total_bytes > 0);
        assert!(capacity.free_bytes <= capacity.total_bytes);
    }
}
