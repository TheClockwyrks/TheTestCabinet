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
        Ok(mut record) => {
            // Upload the produced tree to the artifact service (when configured) and
            // stamp the playable-build link on the record, *before* reporting the
            // terminal status — so by the time the console sees the run finish, its
            // build and media are already servable.
            finalize_artifacts(&config, &mut record).await;
            // For an adversarial run, also mirror the controller wasm + proof
            // replays into the *backend* store (the CLI does this at push). Without
            // it a backend-driven run is invisible to the arena and its replays
            // 404 — a no-op for any other run type.
            finalize_adversarial_backend_upload(&config, &record).await;
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

/// Upload the produced run tree to the artifact service and stamp the run's
/// playable-build link onto `record`, when an artifact service is configured
/// (`TCAB_ARTIFACTS_URL`).
///
/// The link is set root-relative (`/runs/{id}/build/`) — the console prefixes the
/// artifact base URL it learned from the backend's `/config` — and only when the
/// run produced a static build to serve, mirroring what the worker set at list
/// time. An upload failure is logged but never fatal: the record itself still
/// reaches the backend (only its servable artifacts are missing), and the run
/// outcome is unchanged. When `TCAB_ARTIFACTS_URL` is unset (the local
/// CLI/desktop path) this is a no-op and the record carries no playable link.
async fn finalize_artifacts(config: &Config, record: &mut test_cabinet_core::RunRecord) {
    let Some(artifacts_url) = config.artifacts_url.as_deref() else {
        return;
    };
    let out_dir = config.work_dir.join("out");

    if let Some(link) = test_cabinet_driver::artifacts::playable_build_link(&out_dir, &record.id) {
        record.links.playable_build = Some(link);
    }

    if let Err(err) = test_cabinet_driver::artifacts::upload_run_tree(
        artifacts_url,
        &record.id,
        &config.job_id,
        &out_dir,
        &config.job_token,
    )
    .await
    {
        // A missing upload leaves the run inspectable (its record is still posted),
        // it just cannot be played from the reviewer UI — worth a warning, not a
        // failed run.
        tracing::warn!(run_id = %record.id, error = %err, "could not upload run artifacts");
    } else {
        tracing::info!(run_id = %record.id, "uploaded run artifacts to the artifact service");
    }
}

/// Mirror an adversarial run's controller wasm + proof replays into the **backend
/// store**, so a backend-driven run is pittable in the arena and its replays play
/// back — the backend-driven counterpart to the CLI's push-time upload. A no-op for
/// any non-adversarial run (and a forfeit that produced no controller). Reads the
/// files from the produced tree the driver still holds on disk; an upload failure is
/// logged but never fatal, exactly like the artifact-service upload.
async fn finalize_adversarial_backend_upload(
    config: &Config,
    record: &test_cabinet_core::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_adversarial_to_backend(
        &config.backend_url,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload adversarial controller/replays to the backend store",
        );
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
        failure.state,
        &failure.detail,
        &[],
    ) {
        Ok(mut record) => {
            // A failed run rarely produced a static build, but it may have collected
            // partial artifacts (proof media, an asset frame) worth retaining for
            // inspection — upload them and stamp any build link, the same as a
            // succeeded run, before the terminal status is posted.
            finalize_artifacts(config, &mut record).await;
            Some(record)
        }
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
