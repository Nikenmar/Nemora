// Nora (CMR Fork) - Tauri shell.
//
// This binary is deliberately thin. All business logic lives in TypeScript and
// runs inside the WebView (see `src/platform/`). Rust owns only what a webview
// cannot reach: the ranged media protocol, crash-safe file replacement, the
// tray, Windows taskbar buttons, Discord IPC, and window geometry.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_session;
mod discord;
mod fsops;
mod protocol;
mod secrets;
mod shellops;
mod system;
mod taskbar;
mod window_state;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (including "Open with Nora") forwards its argv to
            // the running instance instead of starting a second app. It is
            // queued as well as emitted, because this can fire before the
            // webview has registered its listener on a cold start.
            system::queue_second_instance_args(app, argv);
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Nemora")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            fsops::write_file_atomic,
            // JSON stores go through the text form: `invoke` serialises a
            // Vec<u8> argument as a JSON array of numbers, so songs.json would
            // otherwise cross IPC as ~1.4 million numbers per save.
            fsops::write_text_file_atomic,
            // Path-to-path: for data already on disk, no bytes cross IPC at all.
            fsops::copy_file_atomic,
            fsops::read_head,
            fsops::disk_capacity,
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
            system::profile_dir_override,
            system::selfcheck_output_path,
            system::benchmark_mode,
        ])
        .register_asynchronous_uri_scheme_protocol("nemora", |_ctx, request, responder| {
            // Serving happens off the main thread: a cold 50 MB read must never
            // block the UI.
            std::thread::spawn(move || {
                responder.respond(protocol::serve(&request));
            });
        })
        .manage(system::PendingSecondInstanceArgs::default())
        .manage(shellops::ScreenSleepState::default())
        .setup(|app| {
            system::spawn_system_watcher(app.handle().clone());
            // Debug builds open devtools automatically. A renderer that fails
            // before it can reach the logger leaves no trace anywhere else -
            // the logger is itself an IPC call.
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Nemora");
}
