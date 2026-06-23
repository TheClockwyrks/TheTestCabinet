//! The `tcab-driver` binary entrypoint.
//!
//! Resolves its configuration from the environment the dispatcher set, reports
//! `running` to the backend, drives the one run it was created for while streaming
//! the live events and preview frames back, then reports the terminal status
//! carrying the produced (or failed) record — and exits. There is no server and no
//! flags; everything arrives through `TCAB_*` env (see [`config`]).

use std::process::ExitCode;
use std::sync::Arc;

use test_cabinet_core::write_failed_record;
use time::OffsetDateTime;

use test_cabinet_driver::client::JobClient;
use test_cabinet_driver::config::Config;
use test_cabinet_driver::run::{RunFailure, drive};
use test_cabinet_driver::sink;

#[tokio::main]
async fn main() -> ExitCode {
    // Initialize telemetry and hold the guard for the lifetime of `main`: on drop
    // it flushes any buffered spans/metrics/logs. With no OTLP endpoint configured
    // this installs only the fmt layer (stdout logging) and returns an inert guard
    // — a missing collector is never fatal. Mirrors the worker's `main`.
    let _telemetry = match test_cabinet_telemetry::init(test_cabinet_telemetry::Config::new(
        "tcab-driver",
        env!("CARGO_PKG_VERSION"),
        "info,test_cabinet_driver=info",
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

    let request = config.run_request();
    tracing::info!(
        backend = %config.backend_url,
        job_id = %config.job_id,
        test_case = %request.test_case_slug,
        variant = %request.variant,
        harness = request.harness.as_str(),
        model = %request.model_id,
        "driver executing one run, streaming to the backend"
    );

    let client = Arc::new(JobClient::new(
        config.backend_url.clone(),
        config.job_id.clone(),
        config.job_token.clone(),
    ));

    // Mark the job running before any work, so the console shows it left the queue.
    // A failure to even report this is terminal: the driver cannot stream, so there
    // is nothing useful it can still do.
    if let Err(err) = client.post_status_running().await {
        eprintln!("could not report `running` to the backend: {err}");
        return ExitCode::FAILURE;
    }

    let started_at = OffsetDateTime::now_utc();

    // The relay drains the channel and streams events/preview to the backend. The
    // sinks (held inside `drive`) push onto `tx`; the relay owns `rx`.
    let (tx, rx) = sink::channel();
    let relay = tokio::spawn(sink::relay_task(client.clone(), rx));

    let outcome = drive(&config, &request, &tx).await;

    // Drop the sending half so the relay's channel closes once it drains the
    // backlog, then await it: this guarantees every streamed event has reached the
    // backend (where the relay accumulates them) *before* the terminal status —
    // carrying the record the backend persists from those events — is sent.
    drop(tx);
    if let Err(err) = relay.await {
        tracing::warn!(error = %err, "the relay task panicked");
    }

    match outcome {
        Ok(record) => {
            tracing::info!(run_id = %record.id, "run produced a record; reporting succeeded");
            if let Err(err) = client.post_status_succeeded(record).await {
                eprintln!("could not report `succeeded` to the backend: {err}");
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Err(failure) => report_failure(&client, &config, &request, started_at, failure).await,
    }
}

/// Stream a terminal `failed` status to the backend with a specific reason and
/// whatever record the run managed to produce.
///
/// A run that errors before [`test_cabinet_core::RunEngine::run_resolved`] reaches
/// its success path never writes a [`test_cabinet_core::RunRecord`], so — exactly
/// as the worker does — the driver builds a `Failed` record via
/// [`write_failed_record`] carrying the failure detail, so the run is retained and
/// inspectable rather than vanishing. The backend persists it with the events the
/// relay already accumulated, so the locally-written `events.jsonl` (lost with the
/// ephemeral pod anyway) is immaterial; an empty slice is passed here. The
/// resolved version, when the failure happened after resolution, gives the record
/// its real test type and version.
async fn report_failure(
    client: &JobClient,
    config: &Config,
    request: &test_cabinet_core::RunRequest,
    started_at: OffsetDateTime,
    failure: RunFailure,
) -> ExitCode {
    tracing::warn!(detail = %failure.detail, "run failed; reporting to the backend");
    let record = match write_failed_record(
        &config.work_dir.join("out"),
        &config.job_id,
        request,
        failure.test_case.as_ref(),
        started_at,
        &failure.detail,
        &[],
    ) {
        Ok(record) => Some(record),
        Err(err) => {
            // The record is a courtesy for inspection; if it cannot even be built,
            // still report the failure with its reason so the console is not left
            // waiting on a job that silently died.
            tracing::warn!(error = %err, "could not build the failed run record");
            None
        }
    };
    if let Err(err) = client.post_status_failed(failure.detail, record).await {
        eprintln!("could not report `failed` to the backend: {err}");
        return ExitCode::FAILURE;
    }
    // The run failed, but the driver did its job: it reported the failure with a
    // specific reason. Exit successfully so the Job is not retried by the cluster.
    ExitCode::SUCCESS
}
