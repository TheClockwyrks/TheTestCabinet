//! The gg session under an **operator cancellation**: that raising the run's
//! [latch](RunCancellation) asks the session to stop through the in-container
//! [sentinel](GG_CANCEL_PATH), keeps draining while it winds down so its epilogue is
//! ingested, and hands back a *complete* partial outcome rather than an error.
//!
//! These drive [`run_gg`] against a container double, so the whole branch runs for real —
//! the invocation write, the version probe, the streamed ingest and the cancel race —
//! with only the container itself faked.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::*;
use crate::execution::{ContainerSpec, ContainerStart, ExecOutput, OutputSink};

/// Telemetry a gg session emits before anyone kills it: two billed turns. Shapes taken
/// from the recorded `gg_mock_session.ndjson` capture, so the ingest under test parses
/// exactly what the real binary emits.
const IN_FLIGHT: &[&str] = &[
    r#"{"timestamp":"2026-07-30T00:00:02Z","sessionId":"run-1","type":"usage","profileId":"root","modelId":"mock/echo","tokens":{"uncachedInput":100,"cachedInput":null,"output":20,"reasoning":null},"cost":{"comparable":0.01,"actual":0.01}}"#,
    r#"{"timestamp":"2026-07-30T00:00:03Z","sessionId":"run-1","type":"usage","profileId":"root","modelId":"mock/echo","tokens":{"uncachedInput":100,"cachedInput":null,"output":20,"reasoning":null},"cost":{"comparable":0.01,"actual":0.01}}"#,
];

/// The epilogue a *canceled* gg session emits on its way out — the part that exists only
/// because the host asked it to stop rather than killing it.
const EPILOGUE: &[&str] = &[
    r#"{"timestamp":"2026-07-30T00:00:04Z","sessionId":"run-1","type":"session_summary","summary":{"terminalStatus":"canceled","agentsSpawned":1,"subagentCount":0,"maxSubagentDepth":0,"compactions":0,"ranOutOfContext":false,"contextOverflowCount":0,"finalFullness":0.0222,"issueReviews":0,"reviewCycles":0,"issuesReopened":0,"undocumentedCalls":{"calls":0},"executionMode":"tool_calling","codeExecutions":0,"compileMs":0,"healing":{"healed":0,"applications":0,"stripFences":0,"stripProse":0,"dropDoubledResponse":0,"enabled":[]},"errors":{"turns":2,"errors":0,"maxConsecutive":0,"modelApi":0,"transpile":0,"programFault":0,"sandboxLimit":0,"missingCompletion":0,"loopAborts":0,"loopAbortWords":0,"loopAbortChars":0},"issuesCreated":0,"issuesCompleted":0,"slotCosts":[{"profileId":"root","modelId":"mock/echo","tokens":{"uncachedInput":2600,"cachedInput":null,"output":240,"reasoning":null},"cost":{"comparable":0.0063,"actual":0.0063}}],"effectiveTools":["shell","read_file","write_file","edit_file","list_dir"],"limits":{}}}"#,
    r#"{"timestamp":"2026-07-30T00:00:05Z","sessionId":"run-1","type":"session_ended","status":"canceled"}"#,
];

/// A container double standing in for a run container with gg inside it.
///
/// Its streamed exec plays [`IN_FLIGHT`], then **waits for the cancellation sentinel to be
/// written** before playing [`EPILOGUE`] and exiting — which is exactly the sequence a real
/// canceled session produces, and the only way to prove the host keeps draining rather
/// than walking away the moment it raises the sentinel.
struct GgContainer {
    /// Every path written through `write_container_file`, in order.
    written: Arc<Mutex<Vec<String>>>,
    /// Whether the streamed session should wait for the sentinel at all. `false` models a
    /// session that runs to its own end with nobody cancelling it.
    waits_for_sentinel: bool,
    /// Whether the session ignores the sentinel entirely — a run that will not wind down,
    /// so the host's grace has to end the wait.
    ignores_sentinel: bool,
}

impl GgContainer {
    fn new() -> Self {
        Self {
            written: Arc::new(Mutex::new(Vec::new())),
            waits_for_sentinel: true,
            ignores_sentinel: false,
        }
    }

    /// A session that never winds down, so only the host's grace ends the drain.
    fn unresponsive() -> Self {
        Self {
            ignores_sentinel: true,
            ..Self::new()
        }
    }

    fn sentinel_raised(&self) -> bool {
        self.written
            .lock()
            .expect("written lock")
            .iter()
            .any(|path| path == GG_CANCEL_PATH)
    }
}

#[async_trait::async_trait]
impl ContainerRuntime for GgContainer {
    async fn start(&self, _spec: &ContainerSpec) -> Result<ContainerStart> {
        unreachable!("run_gg drives an already-started container")
    }

    async fn exec(&self, _container: &ContainerHandle, command: &[String]) -> Result<ExecOutput> {
        // `write_container_file` shells out a `dest=<path>` script; capture the path so a
        // test can assert the sentinel was raised, and so the streamed session can notice.
        if let Some(script) = command.last() {
            for line in script.lines() {
                if let Some(dest) = line.strip_prefix("dest=") {
                    let path = dest.trim_matches('\'').to_string();
                    self.written.lock().expect("written lock").push(path);
                }
            }
        }
        Ok(ExecOutput {
            exit_code: 0,
            // The version probe reads stdout; anything non-empty is a version.
            stdout: "gg 0.0.0-test\n".to_string(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn exec_streamed(
        &self,
        _container: &ContainerHandle,
        _command: &[String],
        _idle_timeout: Option<Duration>,
        sink: &mut dyn OutputSink,
    ) -> Result<ExecOutput> {
        for line in IN_FLIGHT {
            sink.on_line(OutputStream::Stdout, line);
        }
        if self.ignores_sentinel {
            // Never returns; the host's grace is what ends this.
            std::future::pending::<()>().await;
        }
        if self.waits_for_sentinel {
            while !self.sentinel_raised() {
                tokio::task::yield_now().await;
            }
        }
        for line in EPILOGUE {
            sink.on_line(OutputStream::Stdout, line);
        }
        Ok(ExecOutput {
            exit_code: 0,
            stdout: String::new(),
            stderr: String::new(),
            idle_timed_out: false,
        })
    }

    async fn stop(&self, _container: &ContainerHandle) -> Result<()> {
        Ok(())
    }
}

/// A local install, so `run_gg` skips the release download entirely.
fn local_install() -> GgInstall {
    GgInstall::Local {
        host_path: PathBuf::from("/nonexistent/gg"),
        container_path: "/tmp/gg".to_string(),
    }
}

/// Drive `run_gg` against `container` with `cancel`, returning its outcome.
async fn drive(
    container: &GgContainer,
    cancel: &RunCancellation,
) -> (Result<HarnessOutcome>, Vec<HarnessEvent>) {
    let handle = ContainerHandle {
        id: "test-container".to_string(),
    };
    let request = gg_request("mock/primary");
    let mut events = CollectingSink::default();
    let outcome = run_gg(
        container,
        &handle,
        &local_install(),
        &request,
        "build a game",
        "/work",
        &[],
        3600,
        "run-1",
        &mut events,
        cancel,
    )
    .await;
    (outcome, events.events)
}

#[tokio::test]
async fn a_canceled_session_is_asked_to_stop_through_the_sentinel() {
    // The kill has to reach gg somehow, and gg is its own process inside the container.
    // Raising the sentinel is that channel; without it the session would run on, spending,
    // until the sandbox went away underneath it.
    let container = GgContainer::new();
    let cancel = RunCancellation::new();
    cancel.cancel();

    let (outcome, _) = drive(&container, &cancel).await;
    outcome.expect("a canceled session is an outcome, not an error");

    assert!(
        container.sentinel_raised(),
        "the cancellation sentinel must be written into the container, got {:?}",
        container.written.lock().expect("written lock"),
    );
}

#[tokio::test]
async fn a_canceled_session_keeps_everything_it_accumulated() {
    // The whole point: a killed run reports the tokens and cost it actually spent, so the
    // operator can see what the run cost them before they stopped it.
    let container = GgContainer::new();
    let cancel = RunCancellation::new();
    cancel.cancel();

    let (outcome, _) = drive(&container, &cancel).await;
    let outcome = outcome.expect("a canceled session is an outcome, not an error");

    assert!(outcome.canceled, "the outcome must be marked canceled");
    assert_eq!(outcome.usage.tokens.uncached_input, Some(200));
    assert_eq!(outcome.usage.tokens.output, Some(40));
    assert_eq!(outcome.reported_cost, Some(0.02));
}

#[tokio::test]
async fn a_canceled_session_is_drained_through_its_epilogue() {
    // Raising the sentinel and walking away would throw away the most valuable part of a
    // gg run's telemetry — the summary it emits as it winds down. The host keeps draining
    // until gg exits, so the epilogue is ingested like any other telemetry.
    let container = GgContainer::new();
    let cancel = RunCancellation::new();
    cancel.cancel();

    let (outcome, events) = drive(&container, &cancel).await;
    let outcome = outcome.expect("a canceled session is an outcome, not an error");

    let summary = outcome
        .gg_summary
        .expect("the wound-down session's summary must be lifted onto the outcome");
    assert_eq!(summary.terminal_status, "canceled");

    // And it reached the run's event stream, which is what the console rebuilds the frozen
    // view from.
    assert!(
        events.iter().any(|event| {
            matches!(&event.kind, EventKind::Gg { event } if matches!(
                event.kind,
                crate::gg::GgTelemetryKind::SessionEnded { .. }
            ))
        }),
        "the terminal event must be bridged onto the run's stream",
    );
}

#[tokio::test]
async fn a_session_that_will_not_wind_down_still_hands_back_what_it_streamed() {
    // The degraded case. A session that ignores the sentinel must not hold the host
    // forever, and giving up on it must not cost the telemetry already ingested — only
    // the epilogue that never came.
    tokio::time::pause();
    let container = GgContainer::unresponsive();
    let cancel = RunCancellation::new();
    cancel.cancel();

    let driven = tokio::spawn(async move {
        let handle = ContainerHandle {
            id: "test-container".to_string(),
        };
        let request = gg_request("mock/primary");
        let mut events = CollectingSink::default();
        run_gg(
            &container,
            &handle,
            &local_install(),
            &request,
            "build a game",
            "/work",
            &[],
            3600,
            "run-1",
            &mut events,
            &cancel,
        )
        .await
    });

    // Let the drain reach the pending session, then run out its grace.
    tokio::task::yield_now().await;
    tokio::time::advance(GG_CANCEL_GRACE + Duration::from_secs(1)).await;

    let outcome = driven
        .await
        .expect("the drive task did not panic")
        .expect("giving up on the wind-down is still an outcome, not an error");

    assert!(outcome.canceled);
    assert_eq!(
        outcome.usage.tokens.uncached_input,
        Some(200),
        "everything streamed before the kill survives the grace running out",
    );
    assert!(
        outcome.gg_summary.is_none(),
        "a session that never wound down emitted no summary",
    );
}

#[tokio::test]
async fn an_uncanceled_session_is_unaffected() {
    // The latch is held by every run, so the ordinary path has to be provably untouched:
    // no sentinel, no cancel marker, and the session classified as it always was.
    let container = GgContainer {
        waits_for_sentinel: false,
        ..GgContainer::new()
    };
    let cancel = RunCancellation::new();

    let (outcome, _) = drive(&container, &cancel).await;
    let outcome = outcome.expect("an ordinary session succeeds");

    assert!(!outcome.canceled);
    assert!(
        !container.sentinel_raised(),
        "a run nobody cancels must never be asked to stop",
    );
    assert_eq!(outcome.usage.tokens.uncached_input, Some(200));
}
