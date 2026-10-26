//! The `tcab-backend` binary entrypoint.
//!
//! Resolves configuration from the environment (§5), builds the backend, and
//! serves the Axum router until terminated. Every request identifies its caller
//! by a Cloudflare Access assertion or a backend-minted token; see
//! `test_cabinet_backend::auth`.
//!
//! On `SIGTERM` it drains as [`test_cabinet_backend::shutdown`] describes and exits
//! 0; an interrupt (`Ctrl-C`) skips the drain delay.

use std::process::ExitCode;

use test_cabinet_backend::config::Config;
use test_cabinet_backend::shutdown::{self, Stopped, Timing};

fn main() -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(err) => {
            eprintln!("could not start the async runtime: {err}");
            return ExitCode::FAILURE;
        }
    };
    let code = runtime.block_on(run());
    // A request still running past the stop deadline may hold a blocking thread (an
    // ingest's scan runs on one), which dropping the runtime would wait for; it is
    // abandoned instead, so the exit stays inside the termination grace.
    runtime.shutdown_background();
    code
}

/// Start the backend, serve it until it is told to stop, then drain it.
async fn run() -> ExitCode {
    // Listen for the stop signals before anything that can take time, so a
    // `SIGTERM` during the start is a request to stop rather than the end of the
    // process by the signal's default action.
    let stop = match shutdown::stop_signal() {
        Ok(stop) => stop,
        Err(err) => {
            eprintln!("cannot listen for the stop signals: {err}");
            return ExitCode::FAILURE;
        }
    };
    let mut stop = Box::pin(stop);

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

    tracing::info!("listening for SIGTERM and interrupts; starting the backend");

    // A stop requested while the backend starts ends the start: nothing has been
    // accepted yet, so there is nothing to drain.
    let built = tokio::select! {
        built = test_cabinet_backend::build(config) => built,
        stop = &mut stop => {
            tracing::info!(?stop, "stopped while starting");
            return ExitCode::SUCCESS;
        }
    };
    let backend = match built {
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

    // Told to stop, the backend drains (the control plane's "Graceful termination",
    // sequenced by `shutdown::serve`). What this replica accepted last, a job's end
    // among it, reaches the other replicas once the requests in flight finish.
    let bus = backend.bus;
    let flush = async move {
        if let Some(bus) = &bus {
            bus.flush(std::time::Duration::from_secs(5)).await;
        }
    };
    let served = shutdown::serve(
        listener,
        backend.router,
        backend.ready.clone(),
        stop,
        flush,
        Timing::default(),
    )
    .await;
    match served {
        Ok(Stopped::Drained | Stopped::DeadlinePassed) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("server error: {err}");
            ExitCode::FAILURE
        }
    }
}
