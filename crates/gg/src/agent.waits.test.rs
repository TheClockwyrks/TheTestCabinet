//! **Waits that must not outlive their answer**: what happens to an agent suspended in a
//! `wait_for_issue` when the thing it is waiting for is never going to happen.
//!
//! A suspended agent is the one agent gg cannot reach at a turn boundary. It is inside a tool call,
//! and the only thing that ends that call is the awaited [issue](crate::board) reaching a terminal
//! state — so any condition that stops issues moving strands it for the rest of the run. There is no
//! diagnostic in that, and no ending: the session future never returns, no `SessionEnded` is emitted
//! at all, and the host is left to call the run hung on a watchdog half an hour later. A run
//! recorded that way loses its metrics and its tree, and it is filed under an infrastructure status
//! rather than under whatever actually went wrong.
//!
//! Two conditions stop issues moving, and they are of completely different kinds:
//!
//! - gg [broke](crate::fault). The run is ending and dispatches nothing further, so every wait in it
//!   is stranded at once, whatever issue it is on. These runs must end as `internal_error` — gg's
//!   own status — rather than as a hang.
//! - The board says so, on a run that is perfectly healthy. Failing an issue does not cascade, so an
//!   issue behind a failed blocker stays open forever: never done, never failed, never dispatchable.
//!   A wait on it is refused with the blocker named, and the run carries on.
//!
//! The third section is the mirror image of both, and the reason a wait is answered from the board
//! rather than from whatever woke it: a wait that *was* released for one of those reasons, on a run
//! that had repaired itself by the time the agent got a slot to resume on. Reporting a wake-up as an
//! answer tells an agent its wait completed on work nobody has done.
//!
//! The last section is what happens when the first two conditions arrive **together**, which is not
//! an edge case but the ordinary shape of a wind-down: gg breaks, and the wind-down then fails the
//! very issue somebody was suspended on. Both of the wait's exits are open on the same poll, and
//! which one it reports has to be a property of gg rather than of a random pick, or two runs of one
//! configuration disagree in the record about why they stopped.
//!
//! Every test here is bounded, because the failure mode of the defect they cover is a test that
//! does not finish rather than one that fails: a scripted session through [`bounded`], and the
//! hand-driven ones through [`until`] and a timeout on the wait's own task.

use super::*;
use crate::board;

use super::fault_tests::PanickingClient;

/// How long a session in this file may take before the wait it is about is judged to have hung.
///
/// Generous against what these runs actually do — a handful of scripted turns and no I/O — because
/// what it is protecting against is an infinite wait, not a slow one.
const WAIT_TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Run a session, failing the test rather than hanging if it does not end.
async fn bounded(
    inv: &GgInvocation,
    emitter: &Emitter,
    factory: ScriptedFactory,
) -> SessionOutcome {
    tokio::time::timeout(
        WAIT_TEST_TIMEOUT,
        run_with_factory(inv, emitter, Arc::new(factory)),
    )
    .await
    .expect("the session must end on its own rather than outlast a suspended wait")
}

/// The status of the session's terminal [`SessionEnded`](GgTelemetryKind::SessionEnded), or `None`
/// when the session emitted none — which is what a hung run looks like from the outside.
fn terminal_status(events: &[GgTelemetryEvent]) -> Option<String> {
    events.iter().rev().find_map(|event| match &event.kind {
        GgTelemetryKind::SessionEnded { status } => Some(status.clone()),
        _ => None,
    })
}

/// How many times `agent_id` was reported [`Blocked`](GgAgentStatus::Blocked) — how many times gg
/// actually suspended it, as opposed to answering it on the call.
fn times_blocked(events: &[GgTelemetryEvent], agent_id: &str) -> usize {
    events
        .iter()
        .filter(|event| {
            event.agent_id.as_deref() == Some(agent_id)
                && matches!(
                    event.kind,
                    GgTelemetryKind::AgentStatus {
                        status: GgAgentStatus::Blocked,
                        ..
                    }
                )
        })
        .count()
}

/// Every `wait_for_issue` result in the stream, as whether it succeeded and what it said.
fn wait_results(events: &[GgTelemetryEvent]) -> Vec<(bool, String)> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::ToolResult {
                name,
                ok,
                summary: Some(summary),
                ..
            } if name == WAIT_FOR_ISSUE_TOOL => Some((*ok, summary.clone())),
            _ => None,
        })
        .collect()
}

/// The [id](test_cabinet_core::gg::GgAgentConfig::id) of the second profile these boards dispatch
/// their issues to — what its roster entry, every issue's `agent`, and its telemetry name it by.
const IMPLEMENTER: &str = "coder";

/// A board configuration in which the root files work for a separate implementer, with **one**
/// running slot and **no** retries.
///
/// The parallelism cap is what makes every test here deterministic rather than raced: the
/// implementer can only start once the root has suspended itself and freed the only slot, so "the
/// root is blocked when the issue's agent runs" is a property of the configuration instead of a
/// hope. No retries keeps a failing issue to one attempt, so the run reaches the failed state these
/// tests are about without scripting the same doomed agent twice.
fn one_slot_board() -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    crate::tools::grant_configured(
        &mut set.agents[0],
        GgCapabilityConfig {
            params: json!({
                PROJECT_MANAGEMENT_PARAM_MERGE_AGENT: ROOT_PROFILE_ID,
                "maxRetries": 0,
            }),
            ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
        },
    );
    set.agents[0].subagents.push(GgSubagentRef::new(
        IMPLEMENTER,
        &[GgSubagentScope::Implementer],
    ));
    set.agents.push(GgAgentConfig {
        id: IMPLEMENTER.to_string(),
        name: "Coder".to_string(),
        model_id: "mock/coder".to_string(),
        ..GgAgentConfig::root()
    });
    set.limits.max_parallel = Some(1);
    set
}

/// A `create_issue` call for the [implementer](IMPLEMENTER), blocked by `blockers`.
fn file_issue(call_id: &str, title: &str, blockers: &[&str]) -> ModelResponse {
    tool_call_response(
        call_id,
        "create_issue",
        json!({
            "title": title,
            "inScope": format!("Do the {title} work."),
            "outOfScope": "Nothing else.",
            "completionCriteria": "It works.",
            "agent": IMPLEMENTER,
            "blockedBy": blockers,
        }),
    )
}

/// A `wait_for_issue` call on `issue_id`.
fn wait_on(call_id: &str, issue_id: &str) -> ModelResponse {
    tool_call_response(call_id, WAIT_FOR_ISSUE_TOOL, json!({ "issueId": issue_id }))
}

/// The two ids gg mints for the ungrouped issues these boards file, in filing order.
const FIRST_ISSUE: &str = "ISSUE-1";
const SECOND_ISSUE: &str = "ISSUE-2";

// ---------------------------------------------------------------------------
// A fault under a suspended wait
// ---------------------------------------------------------------------------

/// **A fault released an agent waiting on the issue it failed, and stranded everyone else.**
///
/// The wind-down fails the issue the faulting agent was implementing, which wakes *that* issue's
/// waiters. An agent waiting on any other issue was not woken by anything: its own issue is
/// perfectly fine and simply never moves again, since a faulted run dispatches nothing. This run —
/// root waits on the second issue, which is blocked by the first, whose agent panics — never
/// returned from its session future at all. No `SessionEnded`, no diagnostic, no record; the host
/// eventually gave up on it and wrote down a hung run, losing the metrics and the tree that are the
/// whole evidence for the defect.
#[tokio::test]
async fn a_fault_releases_an_agent_waiting_on_an_issue_it_did_not_fail() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-fault".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), one_slot_board());

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    file_issue("first", "groundwork", &[]),
                    file_issue("second", "the widget", &[FIRST_ISSUE]),
                    // Suspended here on an issue nothing will ever dispatch: its blocker's agent is
                    // about to panic, and a faulted run re-dispatches nothing.
                    wait_on("wait", SECOND_ISSUE),
                    stop_response(),
                ],
            ))
        })
        .slot(IMPLEMENTER, |b| Box::new(PanickingClient::new(&b.model_id)));

    assert_eq!(
        bounded(&inv, &emitter, factory).await,
        SessionOutcome::HarnessError
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "the run ends as gg's own defect rather than being left for a watchdog to call hung"
    );
    let waits = wait_results(&events);
    assert_eq!(
        waits.len(),
        1,
        "the suspended wait produced exactly one result: {waits:?}"
    );
    let (ok, summary) = &waits[0];
    assert!(
        !ok && summary.contains(SECOND_ISSUE),
        "a wait released with no answer is an error naming its issue, never a resolution: \
         {waits:?}"
    );
    assert_eq!(
        last_issue_status(&events, SECOND_ISSUE),
        Some(GgIssueStatus::Open),
        "the awaited issue was never worked, which is exactly why the wait had to be released \
         from outside it"
    );
}

/// **A fault stranded a wait begun after it was raised, on an issue that was ready to go.**
///
/// The other half of the same hole, and the one with no failed issue anywhere near it. A faulted run
/// refuses to dispatch, so an issue filed after the fault stays open, unassigned and ready — nothing
/// is wrong with it and nothing will ever pick it up. A turn already in flight when the fault landed
/// goes on to make its remaining calls, and a `wait_for_issue` among them used to suspend the agent
/// on that issue for good.
///
/// The turn is a single assistant message making four calls, because that is the shape that reaches
/// it: the root delegates, blocks on the child (freeing the only slot, so the child runs and
/// panics), and then — woken, mid-turn, with the fault already latched and no boundary between it
/// and the rest of its calls — files an issue and waits on it.
#[tokio::test]
async fn a_fault_releases_a_wait_begun_after_it_was_raised() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-late".to_string()), Box::new(sink.clone()));

    let mut set = one_slot_board();
    // The implementer is also spawnable, so one profile plays both parts: the child whose panic
    // raises the fault, and the assignee of an issue the faulted run then refuses to dispatch.
    set.agents[0].subagents = vec![GgSubagentRef::new(
        IMPLEMENTER,
        &[GgSubagentScope::Subagent, GgSubagentScope::Implementer],
    )];
    crate::tools::grant(&mut set.agents[0], CAPABILITY_SUBAGENTS);
    let inv = invocation(dir.path(), set);

    let delegate_then_file = ModelResponse {
        text: Some("Delegating, then filing the follow-up work.".to_string()),
        tool_calls: vec![
            ToolCall {
                id: "call_spawn".to_string(),
                name: "spawn_subagent".to_string(),
                arguments: json!({ "prompt": "Do the work.", "agent": IMPLEMENTER }),
            },
            ToolCall {
                id: "call_wait_child".to_string(),
                name: "wait_for_subagents".to_string(),
                arguments: json!({}),
            },
            ToolCall {
                id: "call_file".to_string(),
                name: "create_issue".to_string(),
                arguments: json!({
                    "title": "the follow-up",
                    "inScope": "Do the follow-up work.",
                    "outOfScope": "Nothing else.",
                    "completionCriteria": "It works.",
                    "agent": IMPLEMENTER,
                }),
            },
            ToolCall {
                id: "call_wait_issue".to_string(),
                name: WAIT_FOR_ISSUE_TOOL.to_string(),
                arguments: json!({ "issueId": FIRST_ISSUE }),
            },
        ],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        loop_aborts: 0,
    };

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, move |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![delegate_then_file.clone(), stop_response()],
            ))
        })
        .slot(IMPLEMENTER, |b| Box::new(PanickingClient::new(&b.model_id)));

    assert_eq!(
        bounded(&inv, &emitter, factory).await,
        SessionOutcome::HarnessError
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_INTERNAL_ERROR),
        "a wait made after the fault must not be the thing that stops the run ending"
    );
    let waits = wait_results(&events);
    assert!(
        waits.iter().any(|(ok, summary)| !ok
            && summary.contains(FIRST_ISSUE)
            && summary.contains("run is ending")),
        "the wait is refused outright, saying why, rather than suspending the agent: {waits:?}"
    );
    assert_eq!(
        last_issue_status(&events, FIRST_ISSUE),
        Some(GgIssueStatus::Open),
        "the issue was ready and unclaimed the whole time — a faulted run dispatches nothing"
    );
    assert_eq!(
        times_blocked(&events, ROOT_AGENT_ID),
        1,
        "the root suspended once, on its child. The issue wait is answered on the call: a run that \
         has already broken has nothing to suspend an agent for, and freeing its slot only to hand \
         it back leaves the wind-down queueing behind whatever took it"
    );
}

// ---------------------------------------------------------------------------
// A wait nothing can satisfy, on a healthy run
// ---------------------------------------------------------------------------

/// **A wait on an issue behind a failed blocker hung a run gg never broke.**
///
/// Failing an issue does not cascade: a dependent stays open, so the board shows one red issue and
/// the work stalled behind it rather than a column of failures with no cause among them. The
/// consequence for a *waiter* had no answer at all. The dependent is not dispatchable (only a `done`
/// blocker clears an edge) so it is never worked, and it is not terminal either, so the wait never
/// resolves — an agent parked until the run's wall clock ran out, on a run whose model was doing
/// nothing wrong.
///
/// The blocker fails while the agent is already suspended, so this is the wake-up path: the board
/// move that fails one issue has to settle the waits on everything behind it.
#[tokio::test]
async fn a_wait_behind_a_failing_blocker_is_refused_rather_than_left_suspended() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-blocked".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), one_slot_board());

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    file_issue("first", "groundwork", &[]),
                    file_issue("second", "the widget", &[FIRST_ISSUE]),
                    wait_on("wait", SECOND_ISSUE),
                    stop_response(),
                ],
            ))
        })
        // The blocker's agent ends on a model error rather than a completion, and with no retries
        // that is the issue's last attempt.
        .slot(IMPLEMENTER, |_| {
            Box::new(FailingClient {
                mode: FailureMode::Fatal,
            })
        });

    assert_eq!(
        bounded(&inv, &emitter, factory).await,
        SessionOutcome::Ran,
        "nothing in gg broke: the run reaches its own ending"
    );

    let events = sink.events();
    assert_eq!(
        terminal_status(&events).as_deref(),
        Some(STATUS_COMPLETED),
        "a stalled board is the model's outcome to report, not a gg fault and not a hang"
    );
    assert_eq!(
        last_issue_status(&events, FIRST_ISSUE),
        Some(GgIssueStatus::Failed),
        "the blocker spent its one attempt"
    );
    assert_eq!(
        last_issue_status(&events, SECOND_ISSUE),
        Some(GgIssueStatus::Open),
        "failure does not cascade: the dependent is left as it was filed"
    );
    let waits = wait_results(&events);
    assert!(
        waits.iter().any(|(ok, summary)| !ok
            && summary.contains(SECOND_ISSUE)
            && summary.contains(FIRST_ISSUE)),
        "the wait is refused naming the blocker to act on, not left outstanding: {waits:?}"
    );
}

/// **A wait made on an already-unreachable issue must not suspend the agent either.**
///
/// The same refusal from the other direction: the blocker had already failed when the call was made,
/// so there is no board move left to wake anybody with. Waiting first on the blocker itself is what
/// orders the run — that wait resolves normally, on a genuinely terminal issue — and the wait made
/// after it is the one with no future.
#[tokio::test]
async fn a_wait_on_an_already_unreachable_issue_is_refused_on_the_call() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-stalled".to_string()), Box::new(sink.clone()));
    let inv = invocation(dir.path(), one_slot_board());

    let factory = ScriptedFactory::new()
        .slot(ROOT_PROFILE_ID, |b| {
            Box::new(MockClient::new(
                &b.model_id,
                vec![
                    file_issue("first", "groundwork", &[]),
                    file_issue("second", "the widget", &[FIRST_ISSUE]),
                    wait_on("wait_blocker", FIRST_ISSUE),
                    wait_on("wait_dependent", SECOND_ISSUE),
                    stop_response(),
                ],
            ))
        })
        .slot(IMPLEMENTER, |_| {
            Box::new(FailingClient {
                mode: FailureMode::Fatal,
            })
        });

    assert_eq!(bounded(&inv, &emitter, factory).await, SessionOutcome::Ran);

    let events = sink.events();
    let waits = wait_results(&events);
    assert_eq!(waits.len(), 2, "both waits answered: {waits:?}");
    assert!(
        waits[0].0 && waits[0].1.contains(FIRST_ISSUE),
        "the wait on the blocker itself resolves normally — it really did become terminal: \
         {waits:?}"
    );
    assert!(
        !waits[1].0 && waits[1].1.contains(FIRST_ISSUE),
        "the wait behind it is refused on the call, naming the blocker: {waits:?}"
    );
}

// ---------------------------------------------------------------------------
// A wake-up is not an answer
// ---------------------------------------------------------------------------

/// Poll `ready` until it holds, failing the test rather than spinning for ever.
///
/// The waits below are driven by hand — the whole point is to hold the run still in a window a
/// scripted session races through — so each step has to be observed rather than awaited. A bare
/// loop would hang CI on the very regression these are here to catch, which is the failure mode
/// [`bounded`] exists to rule out for the scripted ones.
async fn until(what: &str, mut ready: impl FnMut() -> bool) {
    tokio::time::timeout(WAIT_TEST_TIMEOUT, async {
        while !ready() {
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what}"));
}

/// File one issue for [`IMPLEMENTER`], behind `blockers`, straight onto the board's store.
///
/// Filed rather than driven through a model's tool calls, because what these tests are about is
/// what happens to a wait *after* it is suspended — the run has to be held still at a point a
/// scripted session passes through in microseconds, and a model filing the work would put a whole
/// session between the setup and the moment under test.
fn file_onto(store: &mut board::BoardStore, title: &str, blockers: &[String]) -> String {
    store
        .create_issue(board::NewIssue {
            title,
            in_scope: "Do the work.",
            out_of_scope: "Nothing else.",
            completion_criteria: "It works.",
            agent: IMPLEMENTER,
            blocked_by: blockers,
            ..board::NewIssue::default()
        })
        .expect("the issue is filed")
}

/// The board these hand-driven tests file: `blocker`, and `dependent` behind it.
fn blocked_pair(orch: &Orchestrator) -> (String, String) {
    let store = orch.board.store();
    let mut store = store.lock().expect("board store lock");
    let blocker = file_onto(&mut store, "groundwork", &[]);
    let dependent = file_onto(&mut store, "the widget", std::slice::from_ref(&blocker));
    (blocker, dependent)
}

/// An orchestrator over [`one_slot_board`], for a test that drives the board and the scheduler by
/// hand instead of scripting a model.
fn hand_driven_orchestrator(dir: &TempDir, emitter: &Emitter) -> Arc<Orchestrator> {
    let mut warnings = Vec::new();
    Arc::new(
        Orchestrator::build(
            &invocation(dir.path(), one_slot_board()),
            emitter,
            Arc::new(ScriptedFactory::new()),
            crate::tools::real_shell(),
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
            &mut crate::validate::LaunchReport::Discarding,
        )
        .expect("a set with no machines builds an orchestrator"),
    )
}

/// **A wait must not report completion on work that is still to be done.**
///
/// A waiter is woken when its issue *settles* — including when it settles into "nothing can ever
/// finish this", which is what a failed blocker does to everything behind it. But being woken is
/// not resuming: the agent is marked ready and then queues for a running slot, and until one frees
/// up every other agent in the run is still working. One of them can undo exactly what settled the
/// issue — `update_issue` accepts any status, so a failed blocker can go back to `Open`, and a
/// dependency can be dropped outright.
///
/// The wait then resumed on an issue that was open, unblocked, and every bit as unfinished as when
/// it started waiting — and answered `ok`: "Issue `X` is open." An agent told its wait *completed*
/// goes on to build on work nobody has done, which is the one outcome this whole family of
/// refusals exists to prevent. Nothing here is broken and nothing is racing gg: it is a healthy
/// run, a scheduler doing its job, and two agents.
///
/// Driven by hand because that window — woken, not yet granted a slot — is a few instructions wide
/// in a scripted run, and a test that hoped to land in it would prove nothing on the runs it
/// missed.
#[tokio::test]
async fn a_wait_resumed_on_a_revived_issue_is_refused_rather_than_reported_complete() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-wait-revived".to_string()), Box::new(sink.clone()));
    let orch = hand_driven_orchestrator(&dir, &emitter);
    let (blocker, dependent) = blocked_pair(&orch);

    // The waiting agent, running on the board's only slot.
    let hold = SlotHold::default();
    orch.scheduler.acquire_start(None, &hold).await;
    let project = ProjectContext {
        orch: Arc::clone(&orch),
        assigned_issue: None,
        hold: hold.clone(),
    };
    let board = orch.board.shared();
    let awaited = dependent.clone();
    let waiting = tokio::spawn({
        let emitter = emitter.clone();
        async move {
            wait_for_issue_by_id(
                &project,
                &Agent::root(ROOT_PROFILE_ID),
                &board,
                &emitter,
                &awaited,
            )
            .await
        }
    });
    until("the agent must suspend itself on the dependent", || {
        !orch
            .issue_waits
            .lock()
            .expect("issue waits lock")
            .get(&dependent)
            .is_none_or(Vec::is_empty)
    })
    .await;

    // Somebody else takes the freed slot — which is what makes the waiter's resumption a *later*
    // event than its wake-up, exactly as a run with any other work in it does.
    let occupant = SlotHold::default();
    orch.scheduler.acquire_start(None, &occupant).await;

    // The blocker fails, so nothing can ever finish the dependent: the waiter is woken, and waits
    // for a slot.
    orch.board.fail_issue(&blocker);
    orch.wake_settled_issue_waiters();

    // …and then the run repairs itself. The blocker is open again, so the dependent is ordinary
    // unfinished work with an agent's name on it, and the reason the waiter was woken is gone.
    orch.board
        .store()
        .lock()
        .expect("board store lock")
        .update_issue(
            &blocker,
            board::IssueUpdate {
                status: Some(IssueStatus::Open),
                ..board::IssueUpdate::default()
            },
        )
        .expect("a failed issue can be re-opened");
    assert_eq!(
        orch.board.unsatisfiable_blocker(&dependent),
        None,
        "the board is healthy again: nothing about the awaited issue is settled"
    );

    // Only now does the waiter get a slot back and resume.
    orch.scheduler.release(None);
    let outcome = tokio::time::timeout(WAIT_TEST_TIMEOUT, waiting)
        .await
        .expect("the resumed wait must answer rather than hang")
        .expect("the wait task must not panic");

    assert!(
        !outcome.ok,
        "the awaited work has not happened, so the wait did not complete: {outcome:?}"
    );
    assert!(
        outcome.output.contains(&dependent) && !outcome.output.contains("is done"),
        "the refusal names the issue that is still open and claims nothing about it: {}",
        outcome.output
    );
    assert_eq!(
        orch.board.issue_status(&dependent),
        Some(IssueStatus::Open),
        "and the board is left exactly as it was: a wait reports, it does not move issues"
    );
}

// ---------------------------------------------------------------------------
// Both answers at once
// ---------------------------------------------------------------------------

/// How many times the coincidence below is staged.
///
/// One staging cannot tell a deliberate choice from a lucky one: the two arms of the wait's
/// `select!` are both ready, and an unbiased `select!` picks between ready branches at random, so it
/// answers correctly half the time. Repetition is what turns "it happened to be right" into
/// evidence — an unbiased pick survives this many rounds with probability 2⁻³², which is not a flake
/// anybody will ever see. The count is affordable because a round is a fresh board and a fresh
/// suspended agent and nothing else: no model is driven, and no turn is taken.
const COINCIDENT_ROUNDS: usize = 32;

/// **A wait released by gg's own defect reports the defect, even when its issue settled too.**
///
/// This is not a corner: it is what *every* wind-down looks like from inside a wait. gg's teardown
/// of a panicked agent latches the run's [fault](crate::fault) and then fails the issue that agent
/// was implementing and wakes its waiters — so an agent suspended on that issue finds both of its
/// exits open on the same poll, every time. The board's answer is true and useless: the issue is
/// failed *because* the run broke, and reporting it says the model's work ran out of retries when in
/// fact gg fell over underneath it.
///
/// The consequence is not confined to one tool result. That result is the last thing the waiting
/// agent records, so the run's tree carries either the cause or the consequence at that node — and
/// the pick would be made afresh on every run, from a `select!` that chooses at random among ready
/// branches. Two identical runs of one configuration would disagree about why they stopped, which
/// is the one thing a recorded, compared artefact may not do.
///
/// Driven by hand, and with no `await` between the latch and the wake, because the coincidence is
/// the test: a session that raced for it would stage the interesting case on some runs and not
/// others.
#[tokio::test]
async fn a_wait_released_by_a_fault_reports_it_even_when_its_issue_settled_too() {
    for round in 0..COINCIDENT_ROUNDS {
        let dir = TempDir::new().unwrap();
        let sink = CollectingSink::new();
        let emitter = Emitter::with_sink(Some("run-wait-both".to_string()), Box::new(sink.clone()));
        let orch = hand_driven_orchestrator(&dir, &emitter);
        let awaited = {
            let store = orch.board.store();
            let mut store = store.lock().expect("board store lock");
            file_onto(&mut store, "the widget", &[])
        };

        // The waiting agent, running on the board's only slot, suspends on the issue.
        let hold = SlotHold::default();
        orch.scheduler.acquire_start(None, &hold).await;
        let project = ProjectContext {
            orch: Arc::clone(&orch),
            assigned_issue: None,
            hold: hold.clone(),
        };
        let board = orch.board.shared();
        let waiting = tokio::spawn({
            let emitter = emitter.clone();
            let awaited = awaited.clone();
            async move {
                wait_for_issue_by_id(
                    &project,
                    &Agent::root(ROOT_PROFILE_ID),
                    &board,
                    &emitter,
                    &awaited,
                )
                .await
            }
        });
        until("the agent must suspend itself on the issue", || {
            !orch
                .issue_waits
                .lock()
                .expect("issue waits lock")
                .get(&awaited)
                .is_none_or(Vec::is_empty)
        })
        .await;

        // The wind-down, in the order [`AgentTeardown`] performs it: the fault is latched, and the
        // panicked agent's issue is failed and its waiters woken immediately after. There is no
        // `await` between them, so the suspended agent is not polled until both are true — which is
        // exactly the state it is in when a real teardown wakes it.
        orch.fault.in_agent(
            &format!("{awaited}.0i"),
            IMPLEMENTER,
            "its task panicked: the widget exploded",
        );
        orch.board.fail_issue(&awaited);
        orch.wake_issue_waiters(&awaited);
        assert_eq!(
            orch.board.issue_status(&awaited),
            Some(IssueStatus::Failed),
            "round {round}: the board really does have a terminal answer to give, which is what \
             makes the choice a choice"
        );

        let outcome = tokio::time::timeout(WAIT_TEST_TIMEOUT, waiting)
            .await
            .expect("the released wait must answer rather than hang")
            .expect("the wait task must not panic");

        assert!(
            !outcome.ok,
            "round {round}: an issue failed by the wind-down is not a wait that completed: \
             {outcome:?}"
        );
        assert!(
            outcome.output.contains("the widget exploded"),
            "round {round}: the wait must report what broke the run, not what the break did to the \
             board: {}",
            outcome.output
        );
    }
}
