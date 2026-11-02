//! PLAN/21 P21.2: the IPC types, read from the commands themselves.
//!
//! Test-only: specta is a dev-dependency, every command carries `#[cfg_attr(test, specta::specta)]`
//! and every type it takes or answers `#[cfg_attr(test, derive(specta::Type))]`, so a release
//! build is the same code as before. The test writes nothing unless asked; it fails when the view's
//! copy (`src/platform/ipc/generated.ts`) is not what the commands say, or when a command is
//! registered with Tauri but missing here.
//!
//! Regenerate: `NEMORA_WRITE_IPC_TYPES=1 cargo test -p nemora-desktop ipc_types`.

use std::fmt::Write as _;

use specta::Format as _;
use specta::datatype::{DataType, NamedReferenceType, Reference};
use specta::{Types, function::collect_functions};
use specta_typescript::{Typescript, primitives};

const GENERATED: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/platform/ipc/generated.ts");

fn functions(types: &mut Types) -> Vec<specta::datatype::Function> {
    collect_functions![
        crate::core_info,
        crate::window_backdrop::window_backdrop_set,
        crate::bench::bench_background,
        crate::commands::app_hydrate,
        crate::commands::user_data_get,
        crate::commands::user_data_set,
        crate::commands::legacy_import_state,
        crate::commands::library_songs,
        crate::commands::library_song_info,
        crate::commands::library_song_for_playback,
        crate::commands::library_artists,
        crate::commands::artists_toggle_like,
        crate::commands::artist_set_online_artworks,
        crate::commands::library_albums,
        crate::commands::library_genres,
        crate::commands::library_playlists,
        crate::commands::library_search,
        crate::commands::playlist_create,
        crate::commands::playlist_add_songs,
        crate::commands::playlist_rename,
        crate::commands::playlist_remove,
        crate::commands::playlist_remove_song,
        crate::commands::playlist_set_artwork,
        crate::commands::playlist_import,
        crate::commands::playlist_export,
        crate::commands::history_clear,
        crate::commands::rediscover_refresh,
        crate::commands::stats_dashboard,
        crate::commands::stats_export,
        crate::commands::stats_import,
        crate::commands::stats_recap,
        crate::commands::lyrics_get,
        crate::commands::lyrics_save,
        crate::commands::lyrics_store_found,
        crate::tags_cmd::tags_get,
        crate::tags_cmd::tags_update,
        crate::tags_cmd::song_reparse,
        crate::tags_cmd::artwork_save,
        crate::appdata::storage_usage,
        crate::appdata::appdata_export,
        crate::appdata::appdata_import,
        crate::appdata::appdata_reset,
        crate::appdata::song_from_path,
        crate::guessr::guessr_pools,
        crate::guessr::guessr_round,
        crate::guessr::guessr_record,
        crate::guessr::song_moments,
        crate::guessr::guessr_search,
        crate::tags_cmd::artist_duplicates,
        crate::tags_cmd::artist_resolve_duplicates,
        crate::tags_cmd::artist_resolve_separate,
        crate::tags_cmd::artist_resolve_featuring,
        crate::commands::library_blacklist,
        crate::commands::blacklist_songs,
        crate::commands::blacklist_folders,
        crate::commands::library_folders,
        crate::commands::folders_add,
        crate::commands::folders_remove,
        crate::commands::songs_delete_files,
        crate::commands::library_folder_structures,
        crate::commands::library_rescan,
        crate::commands::library_listening,
        crate::commands::favorites_toggle,
        crate::commands::play_record,
        crate::engine::engine_load,
        crate::energy::energy_analysis,
        crate::lyrics_library::lyrics_library,
        crate::lyrics_library::lyrics_search,
        crate::engine::engine_queue_next,
        crate::engine::engine_play,
        crate::engine::engine_pause,
        crate::engine::engine_seek,
        crate::engine::engine_stop,
        crate::engine::engine_volume,
        crate::engine::engine_equalizer,
        crate::engine::engine_speed,
        crate::engine::engine_varispeed,
        crate::engine::engine_reverb,
        crate::correction::autoeq_index,
        crate::foryou::smart_lists,
        crate::foryou::mix_of_day,
        crate::foryou::stats_insights,
        crate::correction::autoeq_profile,
        crate::correction::correction_preview,
        crate::correction::engine_correction,
        crate::engine::engine_clipped,
        crate::versions::version_create,
        crate::versions::version_rename,
        crate::versions::version_update,
        crate::versions::version_remove,
        crate::versions::version_render,
        crate::smtc::smtc_update,
        crate::duels::duel_pair,
        crate::duels::tier_suggestions,
        crate::duels::skip_context,
        crate::duels::tier_suggestion_apply,
        crate::duels::tier_suggestion_dismiss,
        crate::duels::duel_pair_by_ids,
        crate::duels::duel_select_anchor,
        crate::duels::duel_submit,
        crate::duels::duel_skip,
        crate::duels::tournament_start,
        crate::duels::tournament_resume,
        crate::duels::tournament_overview,
        crate::duels::tournament_submit,
        crate::duels::tierlists_list,
        crate::duels::tierlist_add,
        crate::duels::tierlist_save,
        crate::duels::tierlists_remove,
        crate::duels::tierlist_artworks,
        crate::duels::shuffle_data,
        crate::duels::shuffle_explain,
        crate::tastemap::taste_map,
        crate::tastemap::taste_map_rename,
        crate::tastemap::taste_map_session,
        crate::tastemap::taste_map_journey,
        crate::shellops::trash_item,
        crate::shellops::reveal_song_in_file_explorer,
        crate::shellops::reveal_folder_in_file_explorer,
        crate::shellops::open_log_file,
        crate::shellops::directory_size,
        crate::shellops::paths_share_volume,
        crate::shellops::toggle_auto_launch,
        crate::shellops::open_devtools,
        crate::shellops::stop_screen_sleeping,
        crate::shellops::allow_screen_sleeping,
        crate::dragout::start_file_drag,
        crate::taskbar::set_taskbar_buttons,
        crate::taskbar::clear_taskbar_buttons,
        crate::discord::discord_connect,
        crate::discord::discord_set_activity,
        crate::discord::discord_disconnect,
        crate::window_state::clamp_rect_to_single_monitor,
        crate::secrets::secrets_scrypt_key,
        crate::system::get_power_state,
        crate::system::drain_pending_second_instance_args,
        crate::system::startup_args,
        crate::system::benchmark_mode,
        crate::bench::bench_config,
        crate::bench::bench_mark,
        crate::bench::bench_signal,
        crate::bench::bench_quit,
        crate::widget_server::widget_set_state,
        crate::widget_server::widget_set_enabled,
    ](types)
}

/// Tauri names a command's arguments in camelCase for the view (`song_a_id` -> `songAId`).
fn camel(name: &str) -> String {
    let mut out = String::new();
    for (index, part) in name.split('_').enumerate() {
        let mut chars = part.chars();
        match chars.next() {
            Some(first) if index > 0 => {
                out.extend(first.to_uppercase());
                out.push_str(chars.as_str());
            }
            Some(first) => {
                out.push(first);
                out.push_str(chars.as_str());
            }
            None => {}
        }
    }
    out
}

/// A command answering `Result<T, String>` resolves with `T` and rejects with the string.
fn ok_type(types: &Types, dt: &DataType) -> DataType {
    if let DataType::Reference(Reference::Named(named)) = dt
        && let Some(ndt) = types.get(named)
        && ndt.name == "Result"
        && let NamedReferenceType::Reference { generics, .. } = &named.inner
        && let Some((_, ok)) = generics.first()
    {
        return ok.clone();
    }
    dt.clone()
}

/// The wire as the view reads it: serde_json writes every integer as a JSON number and the view has
/// always read them as `number` (ids, milliseconds and counts stay far below 2^53). A float is a
/// `number` too; specta would say `number | null` because serde_json writes a non-finite float as
/// null, which the view's types never allowed for and the core does not send on purpose.
fn wire() -> specta_util::Remapper {
    use specta::datatype::Primitive;
    specta_util::Remapper::new()
        .dangerous_bigints_as_number()
        .rule(Primitive::f64.into(), Primitive::i32.into())
        .rule(Primitive::f32.into(), Primitive::i32.into())
}

pub(crate) fn render() -> String {
    let mut types = Types::default();
    let mut functions = functions(&mut types);
    let wire = wire();
    let types = wire.remap_types(types);
    for function in &mut functions {
        for (_, dt) in &mut function.args {
            *dt = wire.remap_dt(dt.clone());
        }
        function.result = function.result.take().map(|dt| wire.remap_dt(dt));
    }
    let ts = Typescript::default().header(
        "// Generated from the Rust commands by src-tauri/src/ipc_types.rs (PLAN/21 P21.2). Do not edit.\n\
         // Regenerate: NEMORA_WRITE_IPC_TYPES=1 cargo test -p nemora-desktop ipc_types",
    );
    // Serde's two directions apart: what the view sends is read by Deserialize, what it gets back
    // was written by Serialize (`skip_serializing_if` omits a field, `default` lets one be missing).
    // A type whose two shapes differ is exported twice, as `X_Serialize` and `X_Deserialize`.
    let mut out = ts.export(&types, specta_serde::PhasesFormat).expect("the IPC types export");
    let mapped = specta_serde::PhasesFormat.map_types(&types).expect("serde mapping").into_owned();
    let inline = |dt: &DataType, phase: specta_serde::Phase| -> String {
        let dt = specta_serde::select_phase_datatype(dt, &mapped, phase);
        let dt = specta_serde::PhasesFormat.map_type(&mapped, &dt).expect("serde mapping").into_owned();
        let dt = specta_serde::select_phase_datatype(&dt, &mapped, phase);
        primitives::reference(&ts, &mapped, &dt).expect("a type")
    };
    let mut lines: Vec<(String, String)> =
        TYPED_BY_HAND.iter().map(|(name, entry)| ((*name).to_owned(), format!("  {name}: {entry};"))).collect();
    let (mut json_answer, mut json_args) = (Vec::new(), Vec::new());
    for function in &functions {
        let mut args = String::new();
        for (name, dt) in function.args() {
            let optional = if matches!(dt, DataType::Nullable(_)) { "?" } else { "" };
            let _ = write!(args, " {}{optional}: {};", camel(name), inline(dt, specta_serde::Phase::Deserialize));
        }
        let ret = match function.result() {
            Some(dt) => inline(&ok_type(&types, dt), specta_serde::Phase::Serialize),
            None => "null".to_owned(),
        };
        let args = if args.is_empty() { "Record<string, never>".to_owned() } else { format!("{{{args} }}") };
        if mentions_json(&ret) {
            json_answer.push(function.name().to_owned());
        }
        if mentions_json(&args) {
            json_args.push(function.name().to_owned());
        }
        lines.push((function.name().to_owned(), format!("  {}: {{ args: {args}; ret: {ret} }};", function.name())));
    }
    lines.sort();
    json_answer.sort();
    json_args.sort();
    out.push_str(
        "\n/** Every command the core answers: its arguments as the view sends them, and what it resolves with. */\n",
    );
    out.push_str("export interface IpcCommands {\n");
    for (_, line) in lines {
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str("}\n");
    let union = |names: &[String]| names.iter().map(|name| format!("\n  | '{name}'")).collect::<String>();
    let _ = write!(
        out,
        "\n/** Commands whose answer Rust gives as any JSON (`serde_json::Value`): the view states its shape. */\n\
         export type JsonAnswerCommand ={};\n\
         \n/** Commands taking any JSON (`serde_json::Value`) in an argument. */\n\
         export type JsonArgsCommand ={};\n",
        union(&json_answer),
        union(&json_args)
    );
    out
}

/// Whether a rendered type mentions `Value`, serde_json's any-JSON (the only named type by that name).
fn mentions_json(rendered: &str) -> bool {
    rendered.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|word| word == "Value")
}

/// Registered with Tauri but typed here by hand, each for its reason. `track_visuals` answers raw
/// bytes (`tauri::ipc::Response`, no serde shape); from its signature `song_id: String ->
/// Res<Response>`, it resolves with the ArrayBuffer Tauri hands the view.
const TYPED_BY_HAND: &[(&str, &str)] = &[("track_visuals", "{ args: { songId: string }; ret: ArrayBuffer }")];

#[test]
fn ipc_types() {
    let generated = render();
    if std::env::var_os("NEMORA_WRITE_IPC_TYPES").is_some() {
        std::fs::create_dir_all(std::path::Path::new(GENERATED).parent().unwrap()).unwrap();
        std::fs::write(GENERATED, &generated).unwrap();
    }
    let committed = std::fs::read_to_string(GENERATED).unwrap_or_default().replace("\r\n", "\n");
    assert!(
        committed == generated,
        "src/platform/ipc/generated.ts is not what the commands say: run NEMORA_WRITE_IPC_TYPES=1 cargo test -p nemora-desktop ipc_types"
    );
}

/// Every command registered with Tauri is typed here, and nothing else.
#[test]
fn every_registered_command_is_typed() {
    let lib = include_str!("lib.rs");
    let start = lib.find("tauri::generate_handler![").unwrap() + "tauri::generate_handler![".len();
    let end = start + lib[start..].find(']').unwrap();
    let mut registered: Vec<&str> = lib[start..end]
        .split(',')
        .map(|name| name.trim().rsplit("::").next().unwrap())
        .filter(|n| !n.is_empty())
        .collect();
    registered.sort_unstable();
    let mut typed: Vec<String> = functions(&mut Types::default()).iter().map(|f| f.name().to_owned()).collect();
    typed.extend(TYPED_BY_HAND.iter().map(|(name, _)| (*name).to_owned()));
    typed.sort_unstable();
    assert_eq!(registered, typed);
}
