//! The `tcab-auth-service` binary entrypoint.
//!
//! Resolves configuration from the environment, builds the service, and serves
//! the Axum router until terminated. Like the backend, there is no app-level auth
//! guarding the process itself — bind to a private-network interface (e.g. a
//! Tailscale IP) via `TCAB_AUTH_BIND` in production. The bearer tokens it mints
//! are what the backend then requires.

use std::process::ExitCode;

use test_cabinet_auth_service::config::Config;

#[tokio::main]
async fn main() -> ExitCode {
    // Load `.env.auth` beside the project before anything reads the environment.
    // A missing file is fine (variables can be exported instead); `dotenvy` never
    // overrides already-set variables. This runs before telemetry init so any
    // `OTEL_*`/`TCAB_ENV` configured in the file is visible to it.
    let _ = dotenvy::from_filename(".env.auth");

    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-auth-service",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_auth_service=info",
    )) {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("telemetry init error: {err}");
            return ExitCode::FAILURE;
        }
    };

    let config = Config::from_env();

    let service = match test_cabinet_auth_service::build(config).await {
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
    tracing::info!("auth service listening on {}", service.bind);

    if let Err(err) = axum::serve(listener, service.router).await {
        eprintln!("server error: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
