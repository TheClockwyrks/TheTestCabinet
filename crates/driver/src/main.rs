//! The `tcab-driver` binary entrypoint.
//!
//! Resolves its configuration from the environment the dispatcher set, reports
//! `running` to the backend, drives the one run it was created for while streaming
//! the live events and preview frames back, then hands the finished run to durable
//! storage through [`finish`](test_cabinet_driver::finish): the held `storing`
//! report carrying the record, the run tree and bundle uploads, and the terminal
//! status carrying the produced (or failed) record — and exits, successfully once
//! that terminal status landed or was refused. A `SIGTERM` is handled as
//! [`sigterm`](test_cabinet_driver::sigterm) sets: a run holding its record keeps
//! finishing, one that holds none is reported `failed` as `infrastructure`, and
//! either way the sandbox is deleted first. There is no server and no flags;
//! everything arrives through `TCAB_*` env (see
//! [`config`](test_cabinet_driver::config)).

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use test_cabinet_driver::job_api::JobState;
use test_cabinet_driver::{RunCancellation, mint_run_id, write_failed_record};
use time::OffsetDateTime;

use test_cabinet_driver::cancel::{
    CancelDisposition, CancelRace, cancel_disposition, race_cancellation,
};
use test_cabinet_driver::client::JobClient;
use test_cabinet_driver::config::{Config, DriverRuntime};
use test_cabinet_driver::finish::{
    FinishTarget, Mirrors, REPORT_ATTEMPT_TIMEOUT, RunOutcome, finish,
};
use test_cabinet_driver::kubernetes::KubernetesContainerRuntime;
use test_cabinet_driver::run::{RunFailure, drive};
use test_cabinet_driver::sigterm::{
    INTERRUPTED_ATTEMPT_TIMEOUT, INTERRUPTED_REPORT_WAIT, SANDBOX_SWEEP_INTERVAL, Sandbox,
    ShutdownTarget, Stage, StageCell, run_until_shutdown,
};
use test_cabinet_driver::sink;

/// How often the driver polls its own job's state to notice an operator
/// cancellation. Short enough that a killed run stops promptly, long enough to be
/// negligible load on the backend for the run's duration.
const CANCEL_POLL_INTERVAL: Duration = Duration::from_secs(3);

/// How long a canceled **gg** run is given to wind down and hand back its record before
/// the driver stops waiting on the engine.
///
/// It has to cover the whole tail of a run: the session winding down at its next clean
/// turn boundary (itself bounded by `gg_exec`'s own grace), then collecting the produced
/// tree out of the sandbox and uploading it. Generous, because overrunning it costs the
/// operator the produced tree and the folded metrics — everything the cooperative path
/// exists to save — while waiting a few extra minutes on an already-terminal job costs
/// nothing but a pod.
///
/// It bounds the gg path alone. A canceled run of any other harness is
/// [destroyed](CancelDisposition::DestroyNow) rather than waited for, so it never reaches
/// this grace: there is no session to wind down, and holding the driver — and with it a
/// dispatcher scheduling slot — open for twenty minutes would buy nothing.
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

    // The run's identity, minted here rather than inside the engine. The driver has to
    // be able to record the run *itself* when the engine cannot hand a record back — a
    // session that hung, outran its cap, or would not wind down for a cancellation — and
    // by then the engine has already written into `out/<run_id>/`, salvaged session record
    // and all. Minting it here is what makes the record the driver builds name the same
    // run tree the engine wrote, instead of an empty directory beside it.
    let run_id = mint_run_id();

    tracing::info!(
        backend = %config.backend_url,
        job_id = %config.job_id,
        run_id = %run_id,
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

    // Handle `SIGTERM` from here on: the signal is registered before the first
    // report, so the pod's termination is always the driver's to act on.
    let shutdown = sigterm();
    let started_at = OffsetDateTime::now_utc();
    let stage = Arc::new(StageCell::new());
    // Filled by `drive` the moment the definition materializes, so the fallback
    // cancellation path — a gg session that would not wind down inside its grace,
    // which therefore never hands a return value back — and an interrupted run can
    // still be recorded against the run's real case identity and test type.
    let resolved: std::sync::Mutex<Option<test_cabinet_driver::TestCaseVersion>> =
        std::sync::Mutex::new(None);
    let out_dir = config.work_dir.join("out");

    run_until_shutdown(
        &stage,
        run_job(
            &config, &client, &run_id, &request, started_at, &stage, &resolved,
        ),
        shutdown,
        &ShutdownTarget {
            client: &client,
            report_wait: INTERRUPTED_REPORT_WAIT,
            attempt_timeout: Some(INTERRUPTED_ATTEMPT_TIMEOUT),
            sweep_interval: SANDBOX_SWEEP_INTERVAL,
        },
        &DriverSandbox(&config),
        |state, detail| {
            let test_case = resolved.lock().ok().and_then(|slot| slot.clone());
            write_failed_record(
                &out_dir,
                &run_id,
                &request,
                test_case.as_ref(),
                started_at,
                state,
                detail,
                &[],
            )
            .map_err(|err| {
                tracing::warn!(error = %err, "could not build the interrupted run's record");
            })
            .ok()
        },
    )
    .await
}

/// Resolve on the driver's first `SIGTERM`. A signal handler that cannot be
/// installed is logged and never resolves, leaving the signal's default action.
fn sigterm() -> impl std::future::Future<Output = ()> {
    let signal = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate());
    async move {
        match signal {
            Ok(mut signal) => {
                if signal.recv().await.is_some() {
                    return;
                }
            }
            Err(err) => {
                tracing::warn!(error = %err, "could not install the SIGTERM handler");
            }
        }
        std::future::pending().await
    }
}

/// The run's sandbox, as [`run_until_shutdown`] deletes it.
struct DriverSandbox<'a>(&'a Config);

impl Sandbox for DriverSandbox<'_> {
    async fn teardown(&self) -> bool {
        teardown_sandbox(self.0).await
    }
}

/// Run the job: report `starting`, drive the run against an operator's
/// cancellation and finish it. Its exit code is the driver's unless `SIGTERM`
/// interrupts it ([`run_until_shutdown`]).
///
/// `stage` is moved through the run's stages; `resolved` is filled by `drive` the
/// moment the definition materializes.
async fn run_job(
    config: &Config,
    client: &Arc<JobClient>,
    run_id: &str,
    request: &test_cabinet_driver::RunRequest,
    started_at: OffsetDateTime,
    stage: &Arc<StageCell>,
    resolved: &std::sync::Mutex<Option<test_cabinet_driver::TestCaseVersion>>,
) -> ExitCode {
    // Mark the job starting before any work, so the console shows it left the queue
    // and is spinning up (pre-run container setup). The driver advances it to
    // `running` from inside `drive` once setup finishes and the harness session is
    // about to begin. A failure to even report this is terminal: the driver cannot
    // stream, so there is nothing useful it can still do.
    if let Err(err) = client.post_status_starting().await {
        eprintln!("could not report `starting` to the backend: {err}");
        return ExitCode::FAILURE;
    }

    // The relay drains the channel and streams events/preview to the backend. The
    // sinks (held inside `drive`) push onto `tx`; the relay owns `rx`.
    let (tx, rx) = sink::channel();
    let relay = tokio::spawn(sink::relay_task(client.clone(), rx));

    // Race the run against an operator cancellation. `wait_for_cancellation` resolves
    // only when the backend reports this job `canceled`, and what happens then depends
    // on the harness — see the driver's `cancel` module for the reasoning behind the two
    // branches.
    //
    // A **gg** run is wound down: the run's cancellation latch is raised and this keeps
    // awaiting the run, bounded by `CANCEL_WINDDOWN_GRACE`. gg acts on the latch at its
    // next clean turn boundary, after which the run finishes through its ordinary
    // post-session path — collecting the produced tree, folding the accumulated usage
    // into metrics, writing the record — and hands back a complete account of everything
    // it got through, which is what an operator killed it to look at. Past the grace this
    // gives up on the engine and records the run from what the driver itself still holds.
    //
    // A run of any **other** harness is destroyed: the run future is dropped at once and
    // nothing is kept, wherever in the run the kill lands — mid-session or in the
    // post-session tail. Such a harness is a CLI driven through an `exec` with no
    // wind-down protocol to ask for, so it never observes the latch — waiting on it would
    // not produce an early record, only a wait for a session that was always going to run
    // to its own end. Meanwhile the driver Job stays non-terminal and the dispatcher
    // counts non-terminal Jobs against its in-flight cap, so every minute of that wait
    // holds a scheduling slot for a run nobody will ever read. Exiting promptly frees it.
    // A run that reached its *own* ending before this notices the kill is not destroyed
    // — nothing was interrupted — and is finalized below like any other finished run;
    // the backend discards its terminal status, holding the job at `canceled`.
    //
    // Dropping the future stops nothing by itself — the harness is its own process inside
    // the sandbox pod and would keep running, and keep spending — which is why the
    // destroy path below is a drop *plus* `teardown_sandbox`, the call that actually ends
    // it. This is the same both locally (a k3d cluster) and in production: both drive a
    // run through a driver pod that polls its backend job here.
    let cancel = RunCancellation::new();
    let disposition = cancel_disposition(request);
    let raced = race_cancellation(
        drive(config, run_id, request, &tx, client, resolved, &cancel, stage),
        // Announce the kill where it is observed rather than where it is acted on: the
        // wind-down branch says nothing more for up to twenty minutes, and an operator
        // watching the driver's logs needs to see that the kill landed now.
        async {
            wait_for_cancellation(client).await;
            match disposition {
                CancelDisposition::WindDown => tracing::info!(
                    job_id = %config.job_id,
                    "run canceled by operator; winding the session down so its work is recorded"
                ),
                CancelDisposition::DestroyNow => tracing::info!(
                    job_id = %config.job_id,
                    harness = request.harness.as_str(),
                    "run canceled by operator; destroying the run, which has no wind-down to ask for"
                ),
            }
        },
        &cancel,
        disposition,
        CANCEL_WINDDOWN_GRACE,
    )
    .await;
    // The run's own stages are over, wherever the race ended: from here the driver
    // is finishing, which a `SIGTERM` does not cut short.
    stage.set(Stage::Finishing);

    let outcome = match raced {
        CancelRace::Finished(outcome) => Some(outcome),
        CancelRace::WoundDown(outcome) => Some(outcome),
        CancelRace::WindDownExpired => {
            tracing::warn!(
                job_id = %config.job_id,
                seconds = CANCEL_WINDDOWN_GRACE.as_secs(),
                "the canceled run did not wind down in time; recording what is held",
            );
            None
        }
        CancelRace::Destroyed => {
            // The destroyed run is recorded nowhere, deliberately. The backend already
            // holds the job in its terminal `canceled` state, so no status post is owed;
            // with no record to attach them to, the events the relay streamed are
            // orphaned and the run never reaches the run list — which is the point, since
            // there is no early state to inspect for a harness that could not be asked
            // for one.
            //
            // So the relay is abandoned rather than drained. Draining exists to guarantee
            // every event reached the backend *before* the record that anchors them; with
            // no record coming, a flush would only trade the seconds this path exists to
            // save (a preview connection can hold the channel open for its read timeout
            // after the run future is dropped) for events nothing will ever read.
            drop(tx);
            relay.abort();
            // The teardown *is* the kill on this path, so its failure is the one
            // cancellation failure worth reporting as one. Exiting non-zero fails the
            // driver Job, and a failed driver Job is exactly what the dispatcher's
            // orphan-sandbox reaper looks for — a driver that exited without taking its
            // sandbox with it. Exiting `SUCCESS` here would instead leave a harness
            // running, and spending, in a sandbox nothing is watching until the pod's
            // own active deadline (hours) ends it. Nothing re-runs the Job (the
            // dispatcher creates it with a zero backoff limit) and the backend job is
            // already terminally `canceled`, so failing costs only the reap it buys.
            if !teardown_sandbox(config).await {
                return ExitCode::FAILURE;
            }
            // Sweep once more, a beat later. Dropping the run future cancels whatever
            // request it had in flight from the *client* side only: a sandbox whose
            // creation was in flight can still be persisted by the API server just after
            // the sweep above listed, leaving a sandbox that sweep could not see. Nothing
            // else would ever delete it — the reaper only looks at failed driver Jobs,
            // and this one is about to succeed — so it would run the harness until its
            // own active deadline (hours) hit. A second pass costs a couple of seconds
            // against a wait this path exists to cut from twenty minutes.
            tokio::time::sleep(SANDBOX_SWEEP_INTERVAL).await;
            if !teardown_sandbox(config).await {
                return ExitCode::FAILURE;
            }
            return ExitCode::SUCCESS;
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
            // The canceled gg run did not wind down inside the grace, so the engine never
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
            let exit = report_canceled(
                client,
                config,
                run_id,
                request,
                started_at,
                test_case.as_ref(),
                stage,
            )
            .await;
            teardown_sandbox(config).await;
            exit
        }
        Some(Ok(record)) => {
            // A gg run that wound down for an operator's kill takes this same path — it
            // is an ordinary engine outcome, produced by the ordinary post-session
            // stages, and the whole finishing sequence applies to it exactly as it does
            // to a run that finished on its own. Only the terminal status differs: it is
            // `canceled`, carrying the record. The latch is raised on the wind-down
            // branch alone, so a destroyed run returned above and never reaches here.
            //
            // The terminal status follows whether the run was *canceled*, not the
            // record's own state, because those can honestly disagree: a run that
            // reached its own ending in the moment between the kill landing and the
            // driver noticing it hands back a `completed` record against an
            // already-`canceled` job. Its state is recorded as what it truly was, but it
            // is still handed over as a cancellation — the only status the backend
            // accepts on a canceled job, and the difference between retaining that run
            // and silently discarding it.
            let already_canceled = cancel.is_canceled();
            tracing::info!(
                run_id = %record.id,
                state = ?record.status.state,
                already_canceled,
                "run produced a record; handing it to durable storage"
            );
            let out_dir = config.work_dir.join("out");
            let finished = finish(
                &finish_target(config, client, &out_dir, stage),
                Some(record),
                RunOutcome::Succeeded,
                already_canceled,
                &BackendMirrors::new(config, MirrorSet::All),
            )
            .await;
            if already_canceled {
                teardown_sandbox(config).await;
            }
            finished.exit_code()
        }
        Some(Err(failure)) => {
            // The kill landed before the session was launched — during the driver's own
            // setup, the image pull, the sandbox start or the seeding — and the run
            // refused to go further. There is no session's work to preserve and no
            // streamed telemetry worth anchoring, so this is a destroyed run in every
            // respect but the sandbox it may have started: record nothing, post nothing
            // (the job is already terminally `canceled`), tear the sandbox down, exit.
            if failure.canceled_before_session {
                tracing::info!(
                    job_id = %config.job_id,
                    "run canceled before its session was launched; recording nothing"
                );
                if !teardown_sandbox(config).await {
                    return ExitCode::FAILURE;
                }
                return ExitCode::SUCCESS;
            }
            // A gg run that was canceled and then errored on its way out — the sandbox
            // went away under it, say — is still a canceled run, not a failure to
            // report against the model. Record it as one, from what the driver holds.
            // Only the wind-down branch raises the latch, so only a gg run can arrive
            // here canceled; a destroyed run's error is never observed at all, because
            // its future was dropped before it could produce one.
            if cancel.is_canceled() {
                tracing::warn!(
                    detail = %failure.detail,
                    "the canceled run errored while winding down; recording what is held",
                );
                let exit = report_canceled(
                    client,
                    config,
                    run_id,
                    request,
                    started_at,
                    failure.test_case.as_ref(),
                    stage,
                )
                .await;
                teardown_sandbox(config).await;
                return exit;
            }
            report_failure(client, config, run_id, request, started_at, failure, stage).await
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
///
/// This only observes the kill; what the driver then does with the run in flight is the
/// caller's branch on [`CancelDisposition`].
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

/// The **fallback** record for a **gg** run an operator killed: the one the driver builds
/// itself when the engine could not hand one back.
///
/// A killed gg run is normally recorded by the engine, through its ordinary post-session
/// path — that record carries the produced tree, the folded metrics and the session
/// summary, and is what the cooperative wind-down exists to produce. This is what happens
/// when that does not arrive: the session would not wind down inside its grace, or it
/// errored on the way out. The record built here is
/// [`RunState::Canceled`](test_cabinet_driver::RunState::Canceled) all the same, carrying
/// the resolved case identity when the definition had materialized, but it is bare —
/// zero metrics, no tree.
///
/// It is worth building anyway because of what it anchors: the gg run's telemetry —
/// nearly all of what it produced — was streamed as it happened and is already in the
/// backend's hands, and without a record to attach it to the killed run never reaches the
/// run list at all. A record that cannot be built is logged and nothing is posted, the job
/// being already terminal; one that is built takes the whole finishing sequence, and the
/// exit code follows its terminal report.
///
/// Both call sites are on the wind-down branch, so this is reached for a gg run only, and
/// only for one whose session had been launched. A canceled run of any other harness, and
/// a gg run killed before its session was launched, is destroyed and recorded nowhere,
/// which is what the operator asked for: there is no early state to anchor, because there
/// was no session that could be asked to leave one.
async fn report_canceled(
    client: &JobClient,
    config: &Config,
    run_id: &str,
    request: &test_cabinet_driver::RunRequest,
    started_at: OffsetDateTime,
    test_case: Option<&test_cabinet_driver::TestCaseVersion>,
    stage: &StageCell,
) -> ExitCode {
    // The backend holds the streamed events, so the locally-written `events.jsonl`
    // (lost with the ephemeral pod anyway) is immaterial — an empty slice, exactly as
    // `report_failure` passes.
    let record = match write_failed_record(
        &config.work_dir.join("out"),
        run_id,
        request,
        test_case,
        started_at,
        test_cabinet_driver::RunState::Canceled,
        CANCELED_DETAIL,
        &[],
    ) {
        Ok(record) => record,
        Err(err) => {
            tracing::warn!(error = %err, "could not build the canceled run record");
            return ExitCode::SUCCESS;
        }
    };
    // The canceled run takes the whole finishing sequence. On this path the engine
    // never reached artifact collection, so the out directory is usually empty — but a
    // run that errored *after* collecting has a tree and a bundle worth keeping, and a
    // cancellation that could not wind down cleanly still leaves a salvaged, truncated
    // gg session record in the run tree, which the mirrors carry to the backend store.
    let out_dir = config.work_dir.join("out");
    finish(
        &finish_target(config, client, &out_dir, stage),
        Some(record),
        RunOutcome::Canceled,
        true,
        &BackendMirrors::new(config, MirrorSet::Canceled),
    )
    .await
    .exit_code()
}

/// Tear down the run's sandbox, reporting whether it is now gone. Called on **every**
/// cancellation path, and the reason each of them is correct, and on `SIGTERM`
/// ([`DriverSandbox`]), so an interrupted run leaves nothing for the dispatcher's
/// reaper.
///
/// The harness is its own process inside the sandbox, so neither dropping the run future
/// nor the engine returning ends it: the host only ever held the `exec` stream. On the
/// destroy path this call *is* the kill — it is what stops the harness running and
/// spending after the run future is dropped. On the wind-down path the session has
/// already stopped itself, and this reclaims the sandbox the run left behind.
///
/// Both runtimes are torn down from this job's id, which is what makes the call possible
/// at all once the run's own handle on the sandbox has been dropped: under Kubernetes
/// the run's sandbox pod(s) carry it as a label, and under the CLI runtime so does the
/// `docker`/`podman` container (see [`JOB_ID_LABEL`]). A sandbox that is already gone —
/// the ordinary case on the wind-down path — is success either way.
///
/// The call itself is best-effort and never fatal here: it logs and returns `false` on
/// failure. What the caller does with that differs by path, and only the destroy path
/// treats it as a failed run — see the [`CancelRace::Destroyed`] arm.
///
/// [`JOB_ID_LABEL`]: test_cabinet_driver::container::JOB_ID_LABEL
async fn teardown_sandbox(config: &Config) -> bool {
    let torn_down = match config.runtime {
        DriverRuntime::Kubernetes => {
            match KubernetesContainerRuntime::connect(config.kubernetes.clone()).await {
                Ok(runtime) => runtime.delete_run_pods_for_job().await,
                Err(err) => Err(err),
            }
        }
        DriverRuntime::Cli => match test_cabinet_driver::CliContainerRuntime::detect() {
            Ok(runtime) => {
                runtime
                    .for_job(config.job_id.clone())
                    .delete_run_containers_for_job()
                    .await
            }
            Err(err) => Err(err),
        },
    };
    match torn_down {
        Ok(()) => {
            tracing::info!(
                job_id = %config.job_id,
                "tore down the run's sandbox"
            );
            true
        }
        Err(err) => {
            tracing::warn!(
                job_id = %config.job_id,
                error = %err,
                "could not tear down the run's sandbox"
            );
            false
        }
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
    record: &test_cabinet_driver::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_adversarial_to_backend(
        &config.backend_url,
        &config.job_token,
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
    record: &test_cabinet_driver::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_performance_to_backend(
        &config.backend_url,
        &config.job_token,
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
async fn finalize_proof_backend_upload(config: &Config, record: &test_cabinet_driver::RunRecord) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_proofs_to_backend(
        &config.backend_url,
        &config.job_token,
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
    record: &test_cabinet_driver::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_validation_to_backend(
        &config.backend_url,
        &config.job_token,
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

/// Mirror a gg run's session record into the **backend store**, so `GET /runs/{id}/replay` can serve
/// it to a replay driver.
///
/// A no-op for any run with no assembled record at the run tree's root (every non-gg run, and a gg
/// run whose journal never reached the host). Reads the record from the produced tree the driver
/// still holds on disk; an upload failure is logged but never fatal, exactly like the proof and
/// validation uploads.
async fn finalize_replay_backend_upload(config: &Config, record: &test_cabinet_driver::RunRecord) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_replay_to_backend(
        &config.backend_url,
        &config.job_token,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload the gg session record to the backend store",
        );
    }
}

/// Mirror a run's code-analysis document into the **backend store**, so
/// `GET /runs/{id}/code-analysis` can serve the per-run Code tab its unbounded tier —
/// every file, symbol, import edge, cycle and clone group.
///
/// Applies to every harness, unlike the replay mirror. A no-op for a run with no document
/// at the run tree's root. Reads it from the produced tree the driver still holds on disk;
/// an upload failure is logged but never fatal, exactly like the proof and validation
/// uploads. **No figure in the document affects the run's score or verdict**, so a lost
/// upload costs a tab and nothing else.
async fn finalize_code_analysis_backend_upload(
    config: &Config,
    record: &test_cabinet_driver::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_code_analysis_to_backend(
        &config.backend_url,
        &config.job_token,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload the run's code-analysis document to the backend store",
        );
    }
}

/// Mirror an asset-generation run's media (regenerated/preview image + action log)
/// into the **backend store**, so the public snapshot carries it and the published
/// asset result view can display it. A no-op for a non-asset-generation run. Reads
/// the media from the produced tree the driver still holds on disk; an upload failure
/// is logged but never fatal, exactly like the proof and adversarial uploads.
async fn finalize_asset_backend_upload(config: &Config, record: &test_cabinet_driver::RunRecord) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_assets_to_backend(
        &config.backend_url,
        &config.job_token,
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

/// Mirror a run's showcase files (the carousel media, plus any image the
/// description references) into the **backend store**, so the public snapshot
/// carries them and the published Play tab can render the showcase around the
/// playable build. A no-op for a run whose record captured no showcase. Reads the
/// files from the produced tree the driver still holds on disk; an upload failure
/// is logged but never fatal, exactly like the proof and asset uploads — a
/// showcase problem never fails a run.
async fn finalize_showcase_backend_upload(
    config: &Config,
    record: &test_cabinet_driver::RunRecord,
) {
    let out_dir = config.work_dir.join("out");
    if let Err(err) = test_cabinet_driver::artifacts::upload_showcase_to_backend(
        &config.backend_url,
        &config.job_token,
        record,
        &out_dir,
    )
    .await
    {
        tracing::warn!(
            run_id = %record.id,
            error = %err,
            "could not upload the run's showcase files to the backend store",
        );
    }
}

/// Stream a terminal `failed` status to the backend with a specific reason and
/// whatever record the run managed to produce.
///
/// A run that errors before [`test_cabinet_driver::RunEngine::run_resolved`] reaches
/// its success path never writes a [`test_cabinet_driver::RunRecord`], so — exactly
/// as the worker does — the driver builds a `Failed` record via
/// [`write_failed_record`] carrying the failure detail, so the run is retained and
/// inspectable rather than vanishing. The backend persists it with the events the
/// relay already accumulated, so the locally-written `events.jsonl` (lost with the
/// ephemeral pod anyway) is immaterial; an empty slice is passed here. The
/// resolved version, when the failure happened after resolution, gives the record
/// its real test type and version.
///
/// A built record takes the whole finishing sequence (held report, uploads, terminal
/// report); without one the `failed` report is made alone. The exit code follows the
/// terminal report.
async fn report_failure(
    client: &JobClient,
    config: &Config,
    run_id: &str,
    request: &test_cabinet_driver::RunRequest,
    started_at: OffsetDateTime,
    failure: RunFailure,
    stage: &StageCell,
) -> ExitCode {
    tracing::warn!(detail = %failure.detail, "run failed; reporting to the backend");
    let record = match write_failed_record(
        &config.work_dir.join("out"),
        run_id,
        request,
        failure.test_case.as_ref(),
        started_at,
        failure.state,
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
    // A failed run whose record was built takes the same finishing sequence as a
    // succeeded one: a failed run rarely produced a static build, but it may have
    // collected partial artifacts (proof media, an asset frame, its repository) worth
    // retaining. The run failed, but the driver did its job once the report is
    // delivered, so the exit code follows the report alone.
    let out_dir = config.work_dir.join("out");
    finish(
        &finish_target(config, client, &out_dir, stage),
        record,
        RunOutcome::Failed {
            detail: failure.detail,
        },
        false,
        &BackendMirrors::new(config, MirrorSet::Failed),
    )
    .await
    .exit_code()
}

/// Where this driver's finishing calls go, from its configuration.
fn finish_target<'a>(
    config: &'a Config,
    client: &'a JobClient,
    out_dir: &'a std::path::Path,
    stage: &'a StageCell,
) -> FinishTarget<'a> {
    FinishTarget {
        client,
        artifacts_url: config.artifacts_url.as_deref(),
        repos_url: config.repos_url.as_deref(),
        job_id: &config.job_id,
        job_token: &config.job_token,
        out_dir,
        upload_wait: config.upload_wait,
        report_wait: config.report_wait,
        attempt_timeout: Some(REPORT_ATTEMPT_TIMEOUT),
        stage: Some(stage),
    }
}

/// Which of the best-effort backend-store mirrors a finishing path makes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MirrorSet {
    /// A run that produced its record: every mirror.
    All,
    /// A failed run: the gg session record, which a `hung` or `timed_out` gg run
    /// salvages into its tree even though it never reached artifact collection —
    /// the replay of exactly the run most worth replaying.
    Failed,
    /// A canceled run the driver recorded itself: the gg session record a
    /// cancellation that could not wind down cleanly still salvages, and the code
    /// analysis, whatever did land in the run tree being the only account of the
    /// run.
    Canceled,
}

/// The best-effort mirrors of a run's media into the backend store, made by
/// [`finish`] between the uploads and the terminal report. Each logs its own
/// failure and never fails the run.
struct BackendMirrors<'a> {
    config: &'a Config,
    set: MirrorSet,
}

impl<'a> BackendMirrors<'a> {
    fn new(config: &'a Config, set: MirrorSet) -> Self {
        Self { config, set }
    }
}

impl Mirrors for BackendMirrors<'_> {
    async fn mirror(&self, record: &test_cabinet_driver::RunRecord) {
        let config = self.config;
        if self.set == MirrorSet::All {
            // For an adversarial run, mirror the controller wasm + proof replays into
            // the *backend* store (the CLI does this at push). Without it a
            // backend-driven run is invisible to the arena and its replays 404 — a
            // no-op for any other run type.
            finalize_adversarial_backend_upload(config, record).await;
            // For a performance run, mirror each passing case's scored scenario the
            // same way — browser playback fetches it from the backend store and
            // re-simulates it. A no-op for any other run type.
            finalize_performance_backend_upload(config, record).await;
            // The run's proof-of-implementation media: the public snapshot reads proof
            // from the backend store, so without this proof never reaches the
            // published site.
            finalize_proof_backend_upload(config, record).await;
            // The run's synthesized *actual* validation media: the public snapshot
            // reads it from the backend store for the reviewer's side-by-side.
            finalize_validation_backend_upload(config, record).await;
            // An asset-generation run's media (regenerated/preview image + action log).
            finalize_asset_backend_upload(config, record).await;
            // The run's showcase files (the carousel media and any image the
            // description references), for the published Play tab.
            finalize_showcase_backend_upload(config, record).await;
        }
        // A gg run's `.gg/replay.json` record, so `GET /runs/{id}/replay` can serve it
        // to a replay driver. A no-op for any run that captured none.
        finalize_replay_backend_upload(config, record).await;
        if self.set != MirrorSet::Failed {
            // The run's code-analysis document, for the per-run Code tab.
            finalize_code_analysis_backend_upload(config, record).await;
        }
    }
}
