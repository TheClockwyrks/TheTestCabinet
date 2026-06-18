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
    init_tracing();

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

    let backend = match test_cabinet_backend::build(config) {
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

/// Initialize tracing from `RUST_LOG`, defaulting to `info`.
fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,test_cabinet_backend=info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}
