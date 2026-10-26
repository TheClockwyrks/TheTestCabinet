//! The `tcab-backend` binary entrypoint.
//!
//! Resolves configuration from the environment (§5), builds the backend, and
//! serves the Axum router until terminated. Every request identifies its caller
//! by a Cloudflare Access assertion or a backend-minted token; see
//! `test_cabinet_backend::auth`.

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

    if config.artifacts_internal_url.is_none() || config.service_token.is_none() {
        tracing::warn!(
            "TCAB_ARTIFACTS_URL or TCAB_BACKEND_SERVICE_TOKEN is unset; the public dataset is \
             not written: publishes record to the database and regenerate the dataset without \
             writing it. This is a dev-only mode."
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

    // Told to stop, the backend drains: it fails readiness and ends every long-lived
    // stream, and the server stops accepting and finishes the requests in flight
    // before it exits (the control plane's "Graceful termination").
    let ready = backend.ready.clone();
    let bus = backend.bus;
    let shutdown = async move {
        stop_requested().await;
        tracing::info!("stopping: draining the backend");
        ready.mark_draining();
    };
    if let Err(err) = axum::serve(listener, backend.router)
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("server error: {err}");
        return ExitCode::FAILURE;
    }
    // What this replica accepted last, a job's end among it, reaches the others
    // before it exits.
    if let Some(bus) = &bus {
        bus.flush(std::time::Duration::from_secs(5)).await;
    }
    ExitCode::SUCCESS
}

/// Resolve on `SIGTERM`, which Kubernetes sends a pod it stops, or on Ctrl-C.
async fn stop_requested() {
    let interrupt = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut terminate =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(terminate) => terminate,
                Err(err) => {
                    tracing::warn!("cannot listen for SIGTERM ({err}); stopping on Ctrl-C only");
                    let _ = interrupt.await;
                    return;
                }
            };
        tokio::select! {
            _ = interrupt => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = interrupt.await;
    }
}
