fn main() {
    // PLAN/21 P21.2: the IPC types test (src/ipc_types.rs) links every command, and with them the
    // dialog plugin's Common Controls v6 imports; a test binary has no app manifest asking for v6,
    // so Windows refuses to start it. Test binaries only get that dependency; the app is unchanged.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    tauri_build::build()
}
