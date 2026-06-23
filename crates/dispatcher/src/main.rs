//! The `tcab-dispatcher` binary entrypoint.
//!
//! Resolves its configuration from the environment, connects to the Kubernetes API
//! and the backend, and runs the control loop forever: claim queued jobs, create
//! one driver `Job` per run, and report any driver-pod death the driver itself
//! could not. There is no server and no flags; everything arrives through `TCAB_*`
//! env (see [`config`]).

use std::process::ExitCode;

use test_cabinet_dispatcher::config::Config;
use test_cabinet_dispatcher::controller::Dispatcher;

#[tokio::main]
async fn main() -> ExitCode {
    // Initialize telemetry and hold the guard for the lifetime of `main`: on drop
    // it flushes any buffered spans/metrics/logs. With no OTLP endpoint configured
    // this installs only the fmt layer (stdout logging) and returns an inert guard
    // — a missing collector is never fatal. Mirrors the worker's and driver's
    // `main`.
    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-dispatcher",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_dispatcher=info",
    )) {
        Ok(guard) => guard,
        Err(err) => {
            eprintln!("telemetry initialization error: {err}");
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
        namespace = %config.namespace,
        driver_image = %config.driver_image,
        max_inflight = config.max_inflight,
        "dispatcher starting: claiming queued jobs into driver Jobs",
    );

    let dispatcher = match Dispatcher::connect(config).await {
        Ok(dispatcher) => dispatcher,
        Err(err) => {
            eprintln!("could not connect to the Kubernetes API: {err}");
            return ExitCode::FAILURE;
        }
    };

    // The control loop runs forever; it only returns on a fatal error.
    if let Err(err) = dispatcher.run().await {
        eprintln!("dispatcher loop exited: {err}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}
