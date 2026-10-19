//! The `tcab-arena` binary entrypoint.
//!
//! Resolves configuration from the environment, builds the service, and serves
//! the Axum router until terminated. Every route but the health probe needs an
//! identity: the Access assertion every request through the edge carries, verified
//! against `TCAB_ACCESS_TEAM_DOMAIN` and `TCAB_ACCESS_AUDIENCE` (see
//! [`test_cabinet_arena::auth`]). A configuration naming only one of the two
//! `TCAB_ACCESS_*` variables is refused at startup.

use std::process::ExitCode;

use test_cabinet_arena::config::Config;

#[tokio::main]
async fn main() -> ExitCode {
    // Load `.env.arena` beside the project before anything reads the environment.
    // A missing file is fine (variables can be exported instead); `dotenvy` never
    // overrides already-set variables. This runs before telemetry init so any
    // `OTEL_*`/`TCAB_ENV` configured in the file is visible to it.
    let _ = dotenvy::from_filename(".env.arena");

    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-arena",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_arena=info",
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
    tracing::info!(
        backend = %config.backend_url,
        max_concurrent = config.max_concurrent_matches,
        verifies_access = config.access.is_some(),
        "arena service configuration resolved"
    );

    let service = test_cabinet_arena::build(config);

    let listener = match tokio::net::TcpListener::bind(&service.bind).await {
        Ok(listener) => listener,
        Err(err) => {
            eprintln!("could not bind {}: {err}", service.bind);
            return ExitCode::FAILURE;
        }
    };
    tracing::info!("arena service listening on {}", service.bind);

    if let Err(err) = axum::serve(listener, service.router).await {
        eprintln!("server error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
