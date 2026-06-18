//! The `tcab-worker` binary entrypoint.
//!
//! Resolves configuration from the environment, builds the worker, and serves the
//! Axum router until terminated. There is no app-level auth — bind to a
//! private-network interface (e.g. a Tailscale IP) via `TCAB_WORKER_BIND` in
//! production.

use std::process::ExitCode;

use test_cabinet_worker::config::Config;

#[tokio::main]
async fn main() -> ExitCode {
    init_tracing();

    // Load `.env.worker` beside the project before resolving config. A missing
    // file is fine (variables can be exported instead); `dotenvy` never
    // overrides already-set variables.
    let _ = dotenvy::from_filename(".env.worker");

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("configuration error: {err}");
            return ExitCode::FAILURE;
        }
    };

    tracing::info!(
        backend = %config.backend_url,
        out_dir = %config.out_dir.display(),
        "worker resolving definitions from the backend"
    );

    let worker = test_cabinet_worker::build(config);

    let listener = match tokio::net::TcpListener::bind(&worker.bind).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("could not bind {}: {err}", worker.bind);
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("worker listening on {}", worker.bind);

    if let Err(err) = axum::serve(listener, worker.router).await {
        eprintln!("server error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

/// Initialize tracing from `RUST_LOG`, defaulting to `info`.
fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,test_cabinet_worker=info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
