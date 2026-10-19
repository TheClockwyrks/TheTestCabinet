//! The `tcab-artifacts` binary entrypoint.
//!
//! Resolves configuration from the environment, builds the service, and serves
//! the Axum router until terminated. Every route but the health probe needs an
//! identity: the Access assertion an edge request carries, verified against
//! `TCAB_ACCESS_TEAM_DOMAIN` and `TCAB_ACCESS_AUDIENCE`, or one of the in-cluster
//! tokens (see [`test_cabinet_artifacts::auth`]). A configuration naming only one of
//! the two `TCAB_ACCESS_*` variables is refused at startup.

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

    let config = match Config::from_env() {
        Ok(config) => config,
        Err(err) => {
            eprintln!("configuration error: {err}");
            return ExitCode::FAILURE;
        }
    };
    let public_store = match &config.public_store {
        test_cabinet_artifacts::config::PublicStoreConfig::R2(r2) => {
            format!("r2 bucket `{}`", r2.bucket)
        }
        test_cabinet_artifacts::config::PublicStoreConfig::Blob { container } => {
            format!("blob container `{container}`")
        }
    };
    tracing::info!(
        blob.account = %config.blob.account,
        blob.container = %config.blob.container,
        blob.endpoint = %config.blob.endpoint,
        public_store = %public_store,
        backend = %config.backend_url,
        verifies_access = config.access.is_some(),
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
