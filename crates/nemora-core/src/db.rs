//! The library database: one SQLite file per device. Schema contract: `spec/schema-v1.md`, then
//! each numbered migration (`spec/schema-v2.md`, ...).

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::{Error, Result};
use crate::ids;

/// The schema this build creates and understands.
pub const SCHEMA_VERSION: i64 = 2;

const SCHEMA_V1: &str = include_str!("db/schema_v1.sql");
/// Forward migrations: the one at index `i` takes a file from version `i + 1` to `i + 2`.
const MIGRATIONS: &[&str] = &[include_str!("db/migration_v2.sql")];

pub struct Db {
    conn: Connection,
    /// Bumped by every write that can change what a list shows; cached orders older than it are
    /// recomputed.
    generation: AtomicU64,
    /// Ordered variant ids per list (scope + sort), computed once per generation.
    orders: Mutex<HashMap<String, (u64, Arc<Vec<i64>>)>>,
}

impl Db {
    /// Opens or creates the database at `path`, migrating it to [`SCHEMA_VERSION`]. An existing file
    /// at an older version is first copied to `<its folder>/backups/` (`spec/schema-v2.md`).
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Self::init(conn, path.parent())
    }

    /// A private database in memory, for tests and dry runs.
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?, None)
    }

    fn init(conn: Connection, folder: Option<&Path>) -> Result<Self> {
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        let mut db = Self { conn, generation: AtomicU64::new(0), orders: Mutex::new(HashMap::new()) };
        db.migrate(folder)?;
        Ok(db)
    }

    fn migrate(&mut self, folder: Option<&Path>) -> Result<()> {
        let version: i64 = self.conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(Error::SchemaTooNew { found: version, supported: SCHEMA_VERSION });
        }
        if version == SCHEMA_VERSION {
            return Ok(());
        }
        // A file that holds data is copied before it changes: the copy is the way back to an older
        // Nemora, which refuses the newer schema.
        if version > 0
            && let Some(folder) = folder
        {
            self.back_up_before_migrating(folder, version)?;
        }
        let tx = self.conn.transaction()?;
        if version == 0 {
            tx.execute_batch(SCHEMA_V1)?;
            tx.execute("INSERT INTO meta (key, value) VALUES ('device_id', ?1)", params![ids::random()])?;
            tx.execute("INSERT INTO meta (key, value) VALUES ('created_at', ?1)", params![now_ms().to_string()])?;
        }
        // A new file walks the same path as an old one: v1, then every migration.
        for (index, migration) in MIGRATIONS.iter().enumerate() {
            let target = index as i64 + 2;
            if version.max(1) < target {
                tx.execute_batch(migration)?;
                if version > 0 {
                    tx.execute(
                        "INSERT INTO meta (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![format!("migrated_v{target}_at"), now_ms().to_string()],
                    )?;
                }
            }
        }
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        tx.commit()?;
        Ok(())
    }

    /// `VACUUM INTO <folder>/backups/nemora-v<version>-<date>.db`, never over an existing copy.
    fn back_up_before_migrating(&self, folder: &Path, version: i64) -> Result<()> {
        let backups = folder.join("backups");
        std::fs::create_dir_all(&backups)?;
        let day = crate::time::local_day(now_ms(), 0);
        let mut target = backups.join(format!("nemora-v{version}-{day}.db"));
        let mut n = 2;
        while target.exists() {
            target = backups.join(format!("nemora-v{version}-{day}-{n}.db"));
            n += 1;
        }
        self.backup_to(&target)
    }

    pub fn device_id(&self) -> Result<String> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = 'device_id'", [], |row| row.get(0))?)
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| row.get(0)).optional()?)
    }

    /// A consistent copy of the database at `path` (which must not exist), taken while it is in use.
    pub fn backup_to(&self, path: &Path) -> Result<()> {
        self.conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])?;
        Ok(())
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Marks cached list orders stale. Called by every write that changes the library or plays.
    pub fn touch(&self) {
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    /// The cached order for `key`, or `compute`'s result, cached for the current generation.
    pub(crate) fn cached_order(
        &self,
        key: &str,
        compute: impl FnOnce(&Connection) -> Result<Vec<i64>>,
    ) -> Result<Arc<Vec<i64>>> {
        let generation = self.generation.load(Ordering::Relaxed);
        if let Some((g, ids)) = self.orders.lock().unwrap().get(key)
            && *g == generation
        {
            return Ok(Arc::clone(ids));
        }
        let ids = Arc::new(compute(&self.conn)?);
        self.orders.lock().unwrap().insert(key.to_owned(), (generation, Arc::clone(&ids)));
        Ok(ids)
    }

    pub(crate) fn conn(&self) -> &Connection {
        &self.conn
    }

    pub(crate) fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_file_matches_the_spec() {
        let spec = include_str!("../spec/schema-v1.md");
        let start = spec.find("```sql\n").expect("the spec has an SQL block") + "```sql\n".len();
        let end = start + spec[start..].find("```").expect("the SQL block ends");
        assert_eq!(&spec[start..end], SCHEMA_V1, "src/db/schema_v1.sql drifted from spec/schema-v1.md");
    }

    #[test]
    fn a_new_database_gets_the_schema_and_a_device_id() {
        let db = Db::open_in_memory().unwrap();
        let version: i64 = db.conn().pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert!(ids::decode(&db.device_id().unwrap()).is_some());
    }

    #[test]
    fn reopening_keeps_the_device_id() {
        let dir = std::env::temp_dir().join(format!("nemora-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nemora.db");
        let first = Db::open(&path).unwrap().device_id().unwrap();
        let second = Db::open(&path).unwrap().device_id().unwrap();
        assert_eq!(first, second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_newer_schema_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1).unwrap();
        assert!(matches!(Db::init(conn, None), Err(Error::SchemaTooNew { .. })));
    }

    #[test]
    fn migration_v2_matches_its_spec() {
        let spec = include_str!("../spec/schema-v2.md");
        let start = spec.find("```sql\n").expect("the spec has an SQL block") + "```sql\n".len();
        let end = start + spec[start..].find("```").expect("the SQL block ends");
        assert_eq!(&spec[start..end], MIGRATIONS[0], "src/db/migration_v2.sql drifted from spec/schema-v2.md");
    }

    fn tables(db: &Db) -> Vec<String> {
        let mut stmt = db.conn().prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    }

    fn v1_file(conn: &Connection) {
        conn.execute_batch(SCHEMA_V1).unwrap();
        conn.execute("INSERT INTO meta (key, value) VALUES ('device_id', 'DEV')", []).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
    }

    #[test]
    fn a_v1_file_is_backed_up_then_migrated_with_its_rows() {
        let dir = std::env::temp_dir().join(format!("nemora-migrate-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("nemora.db");
        // A v1 file with a row, as 2.x and 3.0 leave it.
        {
            let conn = Connection::open(&path).unwrap();
            v1_file(&conn);
            conn.execute("INSERT INTO tracks VALUES ('s', 'flac', 44100, 16, 2, 1000, NULL, 0, 0)", []).unwrap();
        }
        let db = Db::open(&path).unwrap();
        let version: i64 = db.conn().pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(version, 2);
        assert_eq!(db.device_id().unwrap(), "DEV");
        let tracks: i64 = db.conn().query_row("SELECT count(*) FROM tracks", [], |r| r.get(0)).unwrap();
        assert_eq!(tracks, 1);
        assert!(db.meta("migrated_v2_at").unwrap().is_some());
        for table in ["play_details", "guessr_rounds", "song_signals", "track_features"] {
            assert!(tables(&db).iter().any(|t| t == table), "{table}");
        }
        drop(db);
        // The copy is the v1 file as it was.
        let backups: Vec<_> = std::fs::read_dir(dir.join("backups")).unwrap().flatten().collect();
        assert_eq!(backups.len(), 1);
        let copy = Connection::open(backups[0].path()).unwrap();
        let copy_version: i64 = copy.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap();
        assert_eq!(copy_version, 1);
        drop(copy);
        // Opening again changes nothing and copies nothing.
        Db::open(&path).unwrap();
        assert_eq!(std::fs::read_dir(dir.join("backups")).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_file_walks_the_same_path_as_a_migrated_one() {
        let fresh = Db::open_in_memory().unwrap();
        let conn = Connection::open_in_memory().unwrap();
        v1_file(&conn);
        let migrated = Db::init(conn, None).unwrap();
        assert_eq!(tables(&fresh), tables(&migrated));
        assert!(fresh.meta("migrated_v2_at").unwrap().is_none());
    }
}
