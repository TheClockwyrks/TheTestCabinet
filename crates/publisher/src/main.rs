//! The `tcab-publisher` binary entrypoint.
//!
//! Resolves its configuration from the environment the dispatcher set, then runs
//! the publisher's step sequence (see [`tcab_publisher::sequence`]): the
//! publication preflight, the download of the reviewed run's source tree from the
//! artifact service, the Cloudflare Pages deploy and the GitHub-repo publish, in
//! that order, streaming progress lines to the backend, then reports the terminal
//! [`PublishResult`](test_cabinet_contracts::publish_job_api::PublishResult) —
//! carrying the produced links on success or the reason on failure — and exits.
//! On `SIGTERM` it starts no further step and reports the publish interrupted
//! within the pod's termination grace period. There is no server and no flags;
//! everything arrives through `TCAB_*` env (see [`tcab_publisher::config`]).

use std::process::ExitCode;

use tcab_publisher::client::PublishJobClient;
use tcab_publisher::config::Config;
use tcab_publisher::sequence::{self, Grace, JobSteps, Shutdown, sigterm};

#[tokio::main]
async fn main() -> ExitCode {
    // Listen for SIGTERM before anything else, so a pod stopped at any point
    // after this ends through the sequence's interrupted path rather than the
    // signal's default action.
    let shutdown = Shutdown::on(sigterm());

    // Initialize telemetry and hold the guard for the lifetime of `main`: on drop it
    // flushes any buffered spans/metrics/logs. With no OTLP endpoint configured this
    // installs only the fmt layer (stdout logging) and returns an inert guard — a
    // missing collector is never fatal. Mirrors the driver's `main`.
    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-publisher",
        env!("CARGO_PKG_VERSION"),
        "info,tcab_publisher=info",
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
        publish_job_id = %config.publish_job_id,
        run_id = %config.run_id,
        artifacts = %config.artifacts_url,
        "publisher releasing one run, streaming to the backend"
    );

    let client = PublishJobClient::new(
        config.backend_url.clone(),
        config.publish_job_id.clone(),
        config.publish_job_token.clone(),
    );

    let grace = Grace::new(config.termination_grace);
    let outcome = sequence::run(&mut JobSteps::new(&config, &client), &shutdown, grace).await;
    if outcome.succeeded() {
        tracing::info!(
            run_id = %config.run_id,
            source_repo = ?outcome.result.source_repo,
            playable_build = ?outcome.result.playable_build,
            "release succeeded"
        );
        ExitCode::SUCCESS
    } else {
        // A failed or interrupted publish, or a result the backend never got:
        // exit non-zero so the outcome is visible in the Job's status as well as
        // on the live stream.
        if !outcome.reported {
            eprintln!("could not report the publish result to the backend");
        }
        ExitCode::FAILURE
    }
}
