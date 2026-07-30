//! The `tcab-driver` binary entrypoint.
//!
//! Resolves its configuration from the environment the dispatcher set, reports
//! `running` to the backend, drives the one run it was created for while streaming
//! the live events and preview frames back, then reports the terminal status
//! carrying the produced (or failed) record — and exits. There is no server and no
//! flags; everything arrives through `TCAB_*` env (see
//! [`config`](test_cabinet_driver::config)).

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use test_cabinet_core::job_api::JobState;
use test_cabinet_core::{RunCancellation, write_failed_record};
use time::OffsetDateTime;

use test_cabinet_driver::client::JobClient;
use test_cabinet_driver::config::{Config, DriverRuntime};
use test_cabinet_driver::kubernetes::KubernetesContainerRuntime;
use test_cabinet_driver::run::{RunFailure, drive};
use test_cabinet_driver::sink;

/// How often the driver polls its own job's state to notice an operator
/// cancellation. Short enough that a killed run stops promptly, long enough to be
/// negligible load on the backend for the run's duration.
const CANCEL_POLL_INTERVAL: Duration = Duration::from_secs(3);

/// How long a canceled run is given to wind down and hand back its record before the
/// driver stops waiting on the engine.
///
/// It has to cover the whole tail of a run: the harness winding down at its next clean
/// boundary (itself bounded, for gg, by `gg_exec`'s own grace), then collecting the
/// produced tree out of the sandbox and uploading it. Generous, because overrunning it
/// costs the operator the produced tree and the folded metrics — everything the
/// cooperative path exists to save — while waiting a few extra minutes on an
/// already-terminal job costs nothing but a pod.
const CANCEL_WINDDOWN_GRACE: Duration = Duration::from_secs(1200);

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

    // Mark the job starting before any work, so the console shows it left the queue
    // and is spinning up (pre-run container setup). The driver advances it to
    // `running` from inside `drive` once setup finishes and the harness session is
    // about to begin. A failure to even report this is terminal: the driver cannot
    // stream, so there is nothing useful it can still do.
    if let Err(err) = client.post_status_starting().await {
        eprintln!("could not report `starting` to the backend: {err}");
        return ExitCode::FAILURE;
    }

    let started_at = OffsetDateTime::now_utc();

    // The relay drains the channel and streams events/preview to the backend. The
    // sinks (held inside `drive`) push onto `tx`; the relay owns `rx`.
    let (tx, rx) = sink::channel();
    let relay = tokio::spawn(sink::relay_task(client.clone(), rx));

    // Filled by `drive` the moment the definition materializes, so the fallback
    // cancellation path below — the one that never gets a return value — can still
    // record the killed run against its real case identity and test type.
    let resolved: std::sync::Mutex<Option<test_cabinet_core::TestCaseVersion>> =
        std::sync::Mutex::new(None);

    // Race the run against an operator cancellation. `wait_for_cancellation` resolves
    // only when the backend reports this job `canceled`, so a cancel raises the run's
    // cancellation latch — and then this **keeps awaiting the run**.
    //
    // Not dropping the run future is the whole point. Dropping it would not stop
    // anything that matters (the harness is its own process inside the sandbox and
    // would keep going regardless) and it would skip every stage that turns a session
    // into a result: collecting the produced tree, folding the accumulated usage into
    // metrics, writing the record. Raising the latch instead asks the session to wind
    // down at its next clean boundary, after which the run finishes normally and hands
    // back a complete record of everything it got through — which is what an operator
    // killed it to look at.
    //
    // The wait is bounded. A session that will not wind down must not hold the driver
    // open forever, so past `CANCEL_WINDDOWN_GRACE` this gives up on the engine and
    // falls back to recording the run from what the driver itself still holds. This is
    // the same both locally (a k3d cluster) and in production: both drive a run through
    // a driver pod that polls its backend job here.
    let cancel = RunCancellation::new();
    let outcome = {
        let run = drive(&config, &request, &tx, &client, &resolved, &cancel);
        tokio::pin!(run);
        let observed = tokio::select! {
            outcome = &mut run => Some(outcome),
            () = wait_for_cancellation(&client) => None,
        };
        match observed {
            Some(outcome) => Some(outcome),
            None => {
                tracing::info!(
                    job_id = %config.job_id,
                    "run canceled by operator; winding the session down so its work is recorded"
                );
                cancel.cancel();
                match tokio::time::timeout(CANCEL_WINDDOWN_GRACE, &mut run).await {
                    Ok(outcome) => Some(outcome),
                    Err(_elapsed) => {
                        tracing::warn!(
                            job_id = %config.job_id,
                            seconds = CANCEL_WINDDOWN_GRACE.as_secs(),
                            "the canceled run did not wind down in time; recording what is held",
                        );
                        None
                    }
                }
            }
        }
    };

    // Drop the sending half so the relay's channel closes once it drains the
    // backlog, then await it: this guarantees every streamed event has reached the
    // backend (where the relay accumulates them) *before* the terminal status —
    // carrying the record the backend persists from those events — is sent.
    drop(tx);
    if let Err(err) = relay.await {
        tracing::warn!(error = %err, "the relay task panicked");
    }

    match outcome {
        None => {
            // The canceled run did not wind down inside the grace, so the engine never
            // reached its post-session path and there is no engine-built record. Fall
            // back to recording the run from what the driver itself holds: the killed
            // run still streamed events right up to the kill — for a gg run, the bulk
            // of its telemetry — and the backend needs a record to hang them on or the
            // run vanishes from the run list entirely.
            //
            // This is the degraded path, not the intended one: it loses the produced
            // tree and the folded metrics that a wound-down session hands back. It
            // exists so a session that stops responding cannot cost the operator
            // everything the run had streamed.
            let test_case = resolved.lock().ok().and_then(|slot| slot.clone());
            report_canceled(&client, &config, &request, started_at, test_case.as_ref()).await;
            teardown_sandbox(&config).await;
            ExitCode::SUCCESS
        }
        Some(Ok(mut record)) => {
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
            // For a performance run, mirror each passing case's scored scenario the
            // same way — browser playback fetches it from the backend store and
            // re-simulates it, so without this a backend-driven run's playback has
            // nothing to load. A no-op for any other run type.
            finalize_performance_backend_upload(&config, &record).await;
            // Mirror the run's proof-of-implementation media into the *backend*
            // store too. The artifact service only serves the session that produced
            // the run; the public snapshot reads proof from the backend store, so
            // without this proof never reaches the published site.
            finalize_proof_backend_upload(&config, &record).await;
            // Same for a run's synthesized *actual* validation media (the model
            // build's per-review-item debug-script outputs): the public snapshot reads
            // it from the backend store, so mirror it there or the published site
            // degrades the reviewer's automated-validation side-by-side to
            // presence-only.
            finalize_validation_backend_upload(&config, &record).await;
            // Same for an asset-generation run's media (regenerated/preview image +
            // action log): the public snapshot reads it from the backend store, so
            // mirror it there or the published asset result view has nothing to show.
            finalize_asset_backend_upload(&config, &record).await;
            // For a gg run captured with the (debug-only) replay capability, mirror its
            // `.gg/replay.json` record into the backend store so `GET /runs/{id}/replay`
            // can serve it to a replay driver. A no-op for any run that captured none.
            finalize_replay_backend_upload(&config, &record).await;

            // A run that wound down for an operator's kill took this same path — it is
            // an ordinary engine outcome, produced by the ordinary post-session stages,
            // and every upload above applies to it exactly as it does to a run that
            // finished on its own. Only the terminal status differs.
            //
            // The branch is on whether the run was *canceled*, not on the record's own
            // state, because those can honestly disagree: a run that reached its own
            // ending in the moment between the kill landing and the driver noticing it
            // hands back a `completed` record against an already-`canceled` job. Its
            // state is recorded as what it truly was, but it is still handed over as a
            // cancellation — the only status the backend accepts on a canceled job, and
            // the difference between retaining that run and silently discarding it.
            if cancel.is_canceled() {
                tracing::info!(
                    run_id = %record.id,
                    state = ?record.status.state,
                    "canceled run wound down and produced a record; reporting canceled"
                );
                if let Err(err) = client.post_status_canceled(record).await {
                    // The job is already terminal and the operator has their answer;
                    // failing the driver over the record post would only make the pod
                    // look broken. Log it and exit cleanly.
                    tracing::warn!(error = %err, "could not report `canceled` to the backend");
                }
                teardown_sandbox(&config).await;
                return ExitCode::SUCCESS;
            }

            tracing::info!(run_id = %record.id, "run produced a record; reporting succeeded");
            if let Err(err) = client.post_status_succeeded(record).await {
                eprintln!("could not report `succeeded` to the backend: {err}");
                return ExitCode::FAILURE;
            }
            ExitCode::SUCCESS
        }
        Some(Err(failure)) => {
            // A run that was canceled and then errored on its way out — the sandbox
            // went away under it, say — is still a canceled run, not a failure to
            // report against the model. Record it as one, from what the driver holds.
            if cancel.is_canceled() {
                tracing::warn!(
                    detail = %failure.detail,
                    "the canceled run errored while winding down; recording what is held",
                );
                report_canceled(
                    &client,
                    &config,
                    &request,
                    started_at,
                    failure.test_case.as_ref(),
                )
                .await;
                teardown_sandbox(&config).await;
                return ExitCode::SUCCESS;
            }
            report_failure(&client, &config, &request, started_at, failure).await
        }
    }
}

/// Resolve only when the run is **canceled**: poll this job's backend state and
/// return once it reports `canceled`. Any other state (still running, a transient
/// error, even a not-found) is ignored and polled again on the next tick — the
/// caller races this against the run itself and drops it the moment the run
/// finishes, so it need only ever fire on a real cancellation. The first tick is
/// one interval out, so a run that is not canceled pays a single cheap poll every
/// few seconds and no more.
async fn wait_for_cancellation(client: &JobClient) {
    loop {
        tokio::time::sleep(CANCEL_POLL_INTERVAL).await;
        match client.poll_state().await {
            Ok(Some(JobState::Canceled)) => return,
            Ok(_) => {}
            Err(err) => {
                // A blip talking to the backend is not a reason to stop watching for
                // a cancellation; log at debug and try again next tick.
                tracing::debug!(error = %err, "polling job state for cancellation failed; retrying");
            }
        }
    }
}

/// The detail stamped on a canceled run's record, so the console shows *why* the run
/// ends where it does rather than an unexplained stop.
const CANCELED_DETAIL: &str = "canceled by operator";

/// The **fallback** record for a run an operator killed: the one the driver builds itself
/// when the engine could not hand one back.
///
/// A killed run is normally recorded by the engine, through its ordinary post-session
/// path — that record carries the produced tree, the folded metrics and the session
/// summary, and is what the cooperative cancellation exists to produce. This is what
/// happens when that does not arrive: the session would not wind down inside its grace,
/// or it errored on the way out. The record built here is
/// [`RunState::Canceled`](test_cabinet_core::RunState::Canceled) all the same, carrying
/// the resolved case identity when the definition had materialized, but it is bare —
/// zero metrics, no tree.
///
/// It is worth building anyway because of what it anchors: the run's telemetry (for a gg
/// run, nearly all of what it produced) was streamed as it happened and is already in the
/// backend's hands, and without a record to attach it to the killed run never reaches the
/// run list at all. Everything here is best-effort — the job is already terminal and the
/// sandbox teardown still has to happen, so a failure to record is logged, never fatal.
async fn report_canceled(
    client: &JobClient,
    config: &Config,
    request: &test_cabinet_core::RunRequest,
    started_at: OffsetDateTime,
    test_case: Option<&test_cabinet_core::TestCaseVersion>,
) {
    // The backend holds the streamed events, so the locally-written `events.jsonl`
    // (lost with the ephemeral pod anyway) is immaterial — an empty slice, exactly as
    // `report_failure` passes.
    let record = match write_failed_record(
        &config.work_dir.join("out"),
        &config.job_id,
        request,
        test_case,
        started_at,
        test_cabinet_core::RunState::Canceled,
        CANCELED_DETAIL,
        &[],
    ) {
        Ok(mut record) => {
            // Upload whatever happens to be in the out directory. On this path the
            // engine never reached artifact collection, so it is usually empty — but a
            // run that errored *after* collecting has a tree worth keeping, and the
            // upload is a no-op when there is nothing there.
            finalize_artifacts(config, &mut record).await;
            record
        }
        Err(err) => {
            tracing::warn!(error = %err, "could not build the canceled run record");
            return;
        }
    };
    if let Err(err) = client.post_status_canceled(record).await {
        tracing::warn!(error = %err, "could not report `canceled` to the backend");
    }
}

/// Tear down the run's sandbox on cancellation. Dropping the run future cancels the
/// in-flight harness `exec`, but the sandbox the run created outlives it, so remove
/// it here. Under the Kubernetes runtime — the shape both the local cluster and
/// production use — this deletes the run's sandbox pod(s), selected by this job's
/// id. Best-effort: a failure is logged, never fatal (the job is already terminal).
/// A no-op under the CLI runtime, whose short-lived `docker run` container is not a
/// dispatcher-driven concern.
async fn teardown_sandbox(config: &Config) {
    if config.runtime != DriverRuntime::Kubernetes {
        return;
    }
    match KubernetesContainerRuntime::connect(config.kubernetes.clone()).await {
        Ok(runtime) => match runtime.delete_run_pods_for_job().await {
            Ok(()) => tracing::info!(
                job_id = %config.job_id,
                "tore down the canceled run's sandbox pod"
            ),
            Err(err) => tracing::warn!(
                job_id = %config.job_id,
                error = %err,
                "could not tear down the canceled run's sandbox pod"
            ),
        },
        Err(err) => tracing::warn!(
            job_id = %config.job_id,
            error = %err,
            "could not connect to Kubernetes to tear down the canceled run's sandbox"
        ),
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

/// Mirror a performance run's scored scenarios into the **backend store**, so a
/// backend-driven run's browser playback has something to load — the performance
/// counterpart to [`finalize_adversarial_backend_upload`]. A no-op for any other
/// run type, and for a run whose engine got no case right (playback is offered only
/// for a passing run). An upload failure is logged but never fatal.
async fn finalize_performance_backend_upload(
    config: &Config,
    record: &test_cabinet_core::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_performance_to_backend(
        &config.backend_url,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload performance scenarios to the backend store",
        );
    }
}

/// Mirror a run's proof-of-implementation media into the **backend store**, so the
/// public snapshot the backend exports carries it and the published site can display
/// it — the backend-driven counterpart to the artifact-service tarball, which only
/// serves the session that produced the run. A no-op for a run that declares no
/// proofs. Reads the media from the produced tree the driver still holds on disk; an
/// upload failure is logged but never fatal, exactly like the artifact-service and
/// adversarial uploads.
async fn finalize_proof_backend_upload(config: &Config, record: &test_cabinet_core::RunRecord) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_proofs_to_backend(
        &config.backend_url,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload proof media to the backend store",
        );
    }
}

/// Mirror a run's synthesized *actual* validation media (the model build's
/// per-review-item debug-script outputs) into the **backend store**, so the public
/// snapshot carries it and the published site can show the reviewer's
/// automated-validation side-by-side. A no-op for a run that declares no debug scripts.
/// Reads the media from the produced tree the driver still holds on disk; an upload
/// failure is logged but never fatal, exactly like the proof and asset uploads.
async fn finalize_validation_backend_upload(
    config: &Config,
    record: &test_cabinet_core::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_validation_to_backend(
        &config.backend_url,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload synthesized validation media to the backend store",
        );
    }
}

/// Mirror a gg run's [replay](test_cabinet_core::gg::CAPABILITY_REPLAY) record into the **backend
/// store**, so `GET /runs/{id}/replay` can serve it to a replay driver.
///
/// A no-op for any run that captured no replay (the sidecar absent — replay is opt-in and debug-only).
/// Reads the record from the produced tree the driver still holds on disk; an upload failure is
/// logged but never fatal, exactly like the proof and validation uploads.
async fn finalize_replay_backend_upload(config: &Config, record: &test_cabinet_core::RunRecord) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_replay_to_backend(
        &config.backend_url,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload the gg replay record to the backend store",
        );
    }
}

/// Mirror an asset-generation run's media (regenerated/preview image + action log)
/// into the **backend store**, so the public snapshot carries it and the published
/// asset result view can display it. A no-op for a non-asset-generation run. Reads
/// the media from the produced tree the driver still holds on disk; an upload failure
/// is logged but never fatal, exactly like the proof and adversarial uploads.
async fn finalize_asset_backend_upload(config: &Config, record: &test_cabinet_core::RunRecord) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_assets_to_backend(
        &config.backend_url,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload asset-generation media to the backend store",
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
