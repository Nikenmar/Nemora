//! Nemora 2.0 desktop shell. The data lives in `nemora-core`; this crate hands it to the view in the
//! shapes the 1.1.9 renderer reads (`commands`, `view`) and owns what a webview cannot reach: the
//! ranged media protocol, the tray, taskbar buttons, Discord, the OBS widget and window geometry.

mod app;
mod audio_session;
mod commands;
mod discord;
mod dragout;
mod duels;
mod folders;
mod guessr;
mod protocol;
mod secrets;
// Win32 code carried over from 1.1.9 (edition 2021), where an unsafe fn body was one unsafe block.
#[allow(unsafe_op_in_unsafe_fn)]
mod shellops;
mod system;
mod tags_cmd;
#[allow(unsafe_op_in_unsafe_fn)]
mod taskbar;
mod user_data;
mod view;
mod widget_server;
#[allow(unsafe_op_in_unsafe_fn)]
mod window_backdrop;
#[allow(unsafe_op_in_unsafe_fn)]
mod window_state;

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Overrides where the profile lives; used by tests and by anyone running two builds side by side.
const PROFILE_DIR_ENV: &str = "NEMORA_PROFILE_DIR";

/// The profile folder under the roaming app data directory. A development build must never touch
/// the profile of an installed Nemora: 2.0 imports 1.x data from `%APPDATA%\Nemora`, and a debug
/// build writing there would corrupt the very data the release import reads.
fn profile_dir(roaming: &Path, override_dir: Option<PathBuf>, debug: bool) -> PathBuf {
    override_dir.unwrap_or_else(|| roaming.join(if debug { "Nemora-dev" } else { "Nemora" }))
}

/// Where first start reads 1.x stores: the profile itself, which is where 1.x kept them, unless a
/// development run points elsewhere.
fn legacy_profile(profile: &Path) -> PathBuf {
    std::env::var_os(app::LEGACY_PROFILE_ENV).map(PathBuf::from).unwrap_or_else(|| profile.to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreInfo {
    core_version: &'static str,
    identity_algorithm: &'static str,
    profile_dir: String,
}

#[tauri::command]
fn core_info(app: tauri::State<'_, app::App>) -> CoreInfo {
    CoreInfo {
        core_version: nemora_core::VERSION,
        identity_algorithm: nemora_core::identity::ALGORITHM,
        profile_dir: app.profile.display().to_string(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch ("Open with Nemora") forwards its argv to the running instance. It is
            // queued as well as emitted: on a cold start the webview may not be listening yet.
            system::queue_second_instance_args(app, argv);
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        // Info and up: lofty traces every tag block it reads, which buries a scan's log.
        .plugin(tauri_plugin_log::Builder::new().level(tauri_plugin_log::log::LevelFilter::Info).build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Nemora").args(["--autostart"]).build())
        .invoke_handler(tauri::generate_handler![
            core_info,
            commands::app_hydrate,
            commands::user_data_get,
            commands::user_data_set,
            commands::legacy_import_state,
            commands::library_songs,
            commands::library_song_info,
            commands::library_song_for_playback,
            commands::library_artists,
            commands::library_albums,
            commands::library_genres,
            commands::library_playlists,
            commands::library_search,
            commands::playlist_create,
            commands::playlist_add_songs,
            commands::playlist_rename,
            commands::playlist_remove,
            commands::playlist_remove_song,
            commands::playlist_set_artwork,
            commands::playlist_import,
            commands::playlist_export,
            commands::history_clear,
            commands::rediscover_refresh,
            commands::stats_dashboard,
            commands::stats_export,
            commands::stats_import,
            commands::stats_recap,
            commands::lyrics_get,
            commands::lyrics_save,
            tags_cmd::tags_get,
            tags_cmd::tags_update,
            tags_cmd::song_reparse,
            tags_cmd::artwork_save,
            guessr::guessr_pools,
            guessr::guessr_round,
            guessr::guessr_search,
            tags_cmd::artist_duplicates,
            tags_cmd::artist_resolve_duplicates,
            tags_cmd::artist_resolve_separate,
            tags_cmd::artist_resolve_featuring,
            commands::library_blacklist,
            commands::blacklist_songs,
            commands::blacklist_folders,
            commands::library_folders,
            commands::folders_add,
            commands::folders_remove,
            commands::songs_delete_files,
            commands::library_folder_structures,
            commands::library_rescan,
            commands::library_listening,
            commands::favorites_toggle,
            commands::play_record,
            duels::duel_pair,
            duels::duel_pair_by_ids,
            duels::duel_select_anchor,
            duels::duel_submit,
            duels::duel_skip,
            duels::tournament_start,
            duels::tournament_resume,
            duels::tournament_overview,
            duels::tournament_submit,
            duels::tierlists_list,
            duels::tierlist_add,
            duels::tierlist_save,
            duels::tierlists_remove,
            duels::tierlist_artworks,
            duels::shuffle_data,
            shellops::trash_item,
            shellops::reveal_song_in_file_explorer,
            shellops::reveal_folder_in_file_explorer,
            shellops::open_log_file,
            shellops::directory_size,
            shellops::paths_share_volume,
            shellops::toggle_auto_launch,
            shellops::open_devtools,
            shellops::stop_screen_sleeping,
            shellops::allow_screen_sleeping,
            dragout::start_file_drag,
            taskbar::set_taskbar_buttons,
            taskbar::clear_taskbar_buttons,
            discord::discord_connect,
            discord::discord_set_activity,
            discord::discord_disconnect,
            window_state::clamp_rect_to_single_monitor,
            secrets::secrets_scrypt_key,
            system::get_power_state,
            system::drain_pending_second_instance_args,
            system::startup_args,
            system::benchmark_mode,
            widget_server::widget_set_state,
            widget_server::widget_set_enabled,
        ])
        .register_asynchronous_uri_scheme_protocol("nemora", |_ctx, request, responder| {
            // Off the main thread: a cold 50 MB read must never block the UI.
            std::thread::spawn(move || responder.respond(protocol::serve(&request)));
        })
        .manage(system::PendingSecondInstanceArgs::default())
        .manage(shellops::ScreenSleepState::default())
        .setup(|tauri_app| {
            let roaming = tauri_app.path().data_dir()?;
            let profile =
                profile_dir(&roaming, std::env::var_os(PROFILE_DIR_ENV).map(PathBuf::from), cfg!(debug_assertions));
            tauri_app.manage(app::App::open(&profile)?);

            // First start of a profile that 1.x used: scan its folders and import, without holding
            // up the window. The view asks whether it is running and hears when it is done.
            let legacy = legacy_profile(&profile);
            if tauri_app.state::<app::App>().needs_first_start(&legacy) {
                let handle = tauri_app.handle().clone();
                std::thread::spawn(move || {
                    let state = handle.state::<app::App>();
                    if let Err(error) = state.first_start(&legacy) {
                        eprintln!("[nemora] importing the 1.x profile failed: {error}");
                    }
                    let _ = handle.emit("nemora://legacy-imported", ());
                    commands::notify(
                        &handle,
                        &["songs", "artists", "albums", "genres", "playlists", "userData", "userData/musicFolder"],
                    );
                });
            }

            system::spawn_system_watcher(tauri_app.handle().clone());
            // Paint both layers before the first frame, from native code: the renderer's own call
            // arrives after the profile is readable, far too late for an immediate resize.
            if let Some(window) = tauri_app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::webview::Color(0x21, 0x22, 0x26, 0xff)));
                if let Err(error) = window_backdrop::install(&window, 0x212226) {
                    eprintln!("[nemora] window backdrop unavailable: {error}");
                }
                #[cfg(debug_assertions)]
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nemora");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_builds_never_use_the_installed_profile() {
        let roaming = Path::new(r"C:\Users\someone\AppData\Roaming");
        assert_eq!(profile_dir(roaming, None, true), roaming.join("Nemora-dev"));
        assert_eq!(profile_dir(roaming, None, false), roaming.join("Nemora"));
        let custom = PathBuf::from(r"D:\nemora-test");
        assert_eq!(profile_dir(roaming, Some(custom.clone()), false), custom);
    }
}
