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
    // Load `.env.worker` beside the project before anything reads the
    // environment. A missing file is fine (variables can be exported instead);
    // `dotenvy` never overrides already-set variables. This runs before the
    // telemetry init below so any `OTEL_*`/`TCAB_ENV` configured in the file is
    // visible to it (the file documents those keys as opt-in telemetry switches).
    let _ = dotenvy::from_filename(".env.worker");

    // Initialize telemetry and hold the guard for the lifetime of `main`: on drop
    // it flushes any buffered spans/metrics/logs. With no OTLP endpoint configured
    // this installs only the fmt layer (today's stdout logging) and returns an
    // inert guard — a missing collector is never fatal.
    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-worker",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_worker=info",
    )) {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("telemetry initialization error: {err}");
            return ExitCode::FAILURE;
        }
    };

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
