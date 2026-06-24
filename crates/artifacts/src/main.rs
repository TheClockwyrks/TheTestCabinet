//! The `tcab-artifacts` binary entrypoint.
//!
//! Resolves configuration from the environment, builds the service, and serves
//! the Axum router until terminated. Like the backend and auth service there is no
//! app-level auth guarding the *process* — bind to a private-network interface via
//! `TCAB_ARTIFACTS_BIND` in production. Uploads add a per-job-token check on top of
//! that boundary; reads are ungated (the console loads build/media as browser
//! requests that carry no token), so the boundary is what keeps pre-publish
//! artifacts private.

use std::process::ExitCode;

use test_cabinet_artifacts::config::Config;

#[tokio::main]
async fn main() -> ExitCode {
    // Load `.env.artifacts` beside the project before anything reads the
    // environment. A missing file is fine (variables can be exported instead);
    // `dotenvy` never overrides already-set variables. This runs before telemetry
    // init so any `OTEL_*`/`TCAB_ENV` configured in the file is visible to it.
    let _ = dotenvy::from_filename(".env.artifacts");

    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-artifacts",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_artifacts=info",
    )) {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("telemetry init error: {err}");
            return ExitCode::FAILURE;
        }
    };

    let config = Config::from_env();
    tracing::info!(
        root = %config.root.display(),
        backend = %config.backend_url,
        "artifact service configuration resolved"
    );

    let service = match test_cabinet_artifacts::build(config) {
        Ok(service) => service,
        Err(err) => {
            eprintln!("startup error: {err}");
            return ExitCode::FAILURE;
        }
    };

    let listener = match tokio::net::TcpListener::bind(&service.bind).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("could not bind {}: {err}", service.bind);
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("artifact service listening on {}", service.bind);

    if let Err(err) = axum::serve(listener, service.router).await {
        eprintln!("server error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
