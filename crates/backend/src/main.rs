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
    // stream at once, keeps accepting through the drain delay when told by `SIGTERM`,
    // and only then stops accepting and finishes the requests in flight before it
    // exits (the control plane's "Graceful termination").
    let ready = backend.ready.clone();
    let bus = backend.bus;
    let shutdown = async move {
        let stop = stop_requested().await;
        ready.mark_draining();
        match stop {
            // A request routed by an endpoint list that has not yet dropped this pod
            // still lands for the delay; `/readyz` answers `503` meanwhile.
            Stop::Terminate => {
                tracing::info!(
                    "stopping on SIGTERM: draining, accepting for the {}s drain delay",
                    DRAIN_DELAY.as_secs()
                );
                tokio::time::sleep(DRAIN_DELAY).await;
            }
            // An interrupt at a terminal has no endpoint list to wait out.
            Stop::Interrupt => {
                tracing::info!("stopping on interrupt: draining without the drain delay");
            }
        }
        tracing::info!("no longer accepting; finishing the requests in flight");
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

/// How long a backend told to stop by `SIGTERM` keeps accepting after it fails
/// readiness, while its endpoint's removal from the Service propagates.
const DRAIN_DELAY: std::time::Duration = std::time::Duration::from_secs(5);

/// What told the backend to stop.
enum Stop {
    /// `SIGTERM`, which Kubernetes sends a pod it stops: drain with the delay.
    Terminate,
    /// Ctrl-C (`SIGINT`) at a terminal: drain without it.
    Interrupt,
}

/// Resolve on `SIGTERM` or on Ctrl-C, naming which arrived.
async fn stop_requested() -> Stop {
    let interrupt = tokio::signal::ctrl_c();
    #[cfg(unix)]
    {
        let mut terminate =
            match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
                Ok(terminate) => terminate,
                Err(err) => {
                    tracing::warn!("cannot listen for SIGTERM ({err}); stopping on Ctrl-C only");
                    let _ = interrupt.await;
                    return Stop::Interrupt;
                }
            };
        tokio::select! {
            _ = interrupt => Stop::Interrupt,
            _ = terminate.recv() => Stop::Terminate,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = interrupt.await;
        Stop::Interrupt
    }
}
