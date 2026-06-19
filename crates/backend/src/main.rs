//! The `tcab-backend` binary entrypoint.
//!
//! Resolves configuration from the environment (§5), builds the backend, and
//! serves the Axum router until terminated. There is no app-level auth — bind to
//! a private-network interface (e.g. a Tailscale IP) via `TCAB_BACKEND_BIND` in
//! production.

use std::process::ExitCode;

use test_cabinet_backend::config::Config;

#[tokio::main]
async fn main() -> ExitCode {
    // Load `.env.backend` beside the project before anything reads the
    // environment. A missing file is fine (variables can be exported instead);
    // `dotenvy` never overrides already-set variables. This runs before the
    // telemetry init below so any `OTEL_*`/`TCAB_ENV` configured in the file is
    // visible to it (the file documents those keys as opt-in telemetry switches).
    let _ = dotenvy::from_filename(".env.backend");

    // Initialize telemetry and hold the guard for the whole program so it flushes
    // any buffered spans/metrics/logs on shutdown. Telemetry is opt-in: with
    // `OTEL_EXPORTER_OTLP_ENDPOINT` unset this installs only the fmt logger
    // (today's stdout behavior) and the guard is inert.
    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-backend",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_backend=info",
    )) {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("telemetry init error: {err}");
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

    if config.r2.is_none() {
        tracing::warn!(
            "R2 is not configured (TCAB_R2_* unset); publishes will record to SQLite and \
             regenerate the snapshot but will not upload it. This is a dev-only mode."
        );
    }

    let backend = match test_cabinet_backend::build(config).await {
        Ok(backend) => backend,
        Err(err) => {
            eprintln!("startup error: {err}");
            return ExitCode::FAILURE;
        }
    };

    let listener = match tokio::net::TcpListener::bind(&backend.bind).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("could not bind {}: {err}", backend.bind);
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("backend listening on {}", backend.bind);

    if let Err(err) = axum::serve(listener, backend.router).await {
        eprintln!("server error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
