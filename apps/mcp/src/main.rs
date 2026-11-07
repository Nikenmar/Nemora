//! `nemora-mcp`: Nemora for AI agents (PLAN/22). An agent starts it as a command and speaks MCP
//! over stdin and stdout; it reads the user's Nemora library (read-only for now).
//!
//! `nemora-mcp [--profile <folder>]` serves MCP; `--profile` (or `NEMORA_PROFILE_DIR`) points at
//! another profile than `%APPDATA%\Nemora`.

mod control;
mod docs;
mod pipe;
mod profile;
mod server;

use rmcp::ServiceExt;

fn main() -> std::process::ExitCode {
    let mut args = std::env::args().skip(1);
    let mut explicit = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--profile" => explicit = args.next().map(std::path::PathBuf::from),
            "--version" => {
                println!("nemora-mcp {}", env!("CARGO_PKG_VERSION"));
                return std::process::ExitCode::SUCCESS;
            }
            "--help" | "-h" => {
                println!("nemora-mcp {}: Nemora for AI agents, an MCP server over stdio.", env!("CARGO_PKG_VERSION"));
                println!("Usage: nemora-mcp [--profile <folder>]");
                println!(
                    "Add it to an agent as a command, e.g.: claude mcp add nemora -- \"<path to nemora-mcp.exe>\""
                );
                return std::process::ExitCode::SUCCESS;
            }
            other => {
                eprintln!("nemora-mcp: unknown argument {other} (see --help)");
                return std::process::ExitCode::from(2);
            }
        }
    }
    let profile = profile::profile_dir(explicit);
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("nemora-mcp: {error}");
            return std::process::ExitCode::FAILURE;
        }
    };
    let served = runtime.block_on(async move {
        let service = server::Nemora::new(profile).serve(rmcp::transport::stdio()).await?;
        service.waiting().await?;
        Ok::<_, Box<dyn std::error::Error>>(())
    });
    match served {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("nemora-mcp: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
