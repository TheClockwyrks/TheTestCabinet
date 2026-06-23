//! The `tcab-arena` binary entrypoint.
//!
//! Resolves configuration from the environment, builds the service, and serves
//! the Axum router until terminated. Like the backend, auth, and artifact services
//! there is no app-level auth guarding the *process* — bind to a private-network
//! interface via `TCAB_ARENA_BIND` in production. The arena's run endpoints are
//! deliberately unauthenticated behind that boundary (faithful to the worker the
//! console posts them token-less to).

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

    let config = Config::from_env();
    tracing::info!(
        backend = %config.backend_url,
        max_concurrent = config.max_concurrent_matches,
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
