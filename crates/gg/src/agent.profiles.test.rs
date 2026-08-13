//! **An agent profile the run does not declare**, at each of the five sites that resolve one.
//!
//! Every one of these is unreachable through the production launch path, and that is the point:
//! [`validate_agents`] rejects a roster reference to an undeclared profile, [`crate::fsm::validate`]
//! rejects a state that names one, the board holds an issue's assignee and its reviewers to the
//! filer's own roster, and a succession's target is checked against the roster before it is
//! accepted. So the only thing that can put an undeclared name in front of a resolver is a **gg
//! defect** — and these tests reproduce one the only way it can be reproduced, by building the
//! [`Orchestrator`] directly and skipping the launch checks that stand between a configuration and
//! this state.
//!
//! What they guard is that gg then says so. The tempting alternative is to substitute the
//! [root](GgCapabilitySet::root), and it is far worse than it sounds: the substitute is a different
//! agent — other capabilities, another model, possibly another execution mode — and the record
//! still attributes every turn of it to the profile that was asked for. A run like that does not
//! read as broken, it reads as an answer, and gg exists to produce answers about which
//! configuration did what. So each site must end its work loudly, naming the profile.

use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tempfile::TempDir;

use super::*;
use crate::board::{IssueStatus, NewIssue};
use crate::client::MockClient;
use crate::telemetry::{CollectingSink, Emitter};
use test_cabinet_core::gg::{
    ALL_SUBAGENT_SCOPES, CAPABILITY_EXEC, CAPABILITY_PROJECT_MANAGEMENT, CAPABILITY_SUBAGENTS,
    CAPABILITY_TASKS, GgCapabilityConfig, GgCapabilitySet, GgSubagentRef, GgTelemetryEvent,
    ROOT_AGENT,
};

use super::{ScriptedFactory, invocation};

/// Every `error`-level log message in the stream, in order — where each of these sites reports the
/// defect, since an operator is the only reader who can do anything about one.
fn error_messages(events: &[GgTelemetryEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } if level == "error" => Some(message.clone()),
            _ => None,
        })
        .collect()
}

/// Build the run's [`Orchestrator`] over `set` **without** the launch checks.
///
/// This is the whole trick of the file: the production entry point ([`run_with_seams`]) validates
/// the profiles before it builds anything, so a set carrying an undeclared reference never reaches
/// an orchestrator through it. Reaching in here is the closest a test can stand to the defect being
/// guarded against — gg holding a name nothing declares — without inventing a fake one.
fn orchestrator(dir: &Path, set: GgCapabilitySet, emitter: &Emitter) -> Arc<Orchestrator> {
    let mut warnings = Vec::new();
    Arc::new(
        Orchestrator::build(
            &invocation(dir, set),
            emitter,
            Arc::new(ScriptedFactory::new()),
            crate::tools::real_shell(),
            // No git isolation: none of these tests reaches a worktree, and every one of them
            // fails before an agent could ask for one.
            WorktreesSetup {
                baseline_commit: None,
                root: None,
            },
            &mut warnings,
        )
        // None of these sets declares a machine, so the one thing building an orchestrator can
        // fail on is not in play here — see `a_machine_that_will_not_build_refuses_the_launch`.
        .expect("a set with no machines builds an orchestrator"),
    )
}

/// Drive one agent under `slot` to its ending, with `client` as its first incarnation's model.
async fn drive_slot(orch: Arc<Orchestrator>, slot: &str, client: Box<dyn ModelClient>) -> LoopEnd {
    let (_inbox_tx, inbox_rx) = mpsc::unbounded_channel();
    run_agent(
        orch,
        Agent {
            slot: slot.to_string(),
            ..Agent::root(ROOT_AGENT)
        },
        AgentRole::Root,
        client,
        inbox_rx,
        GgSessionAgentOrigin::Root,
    )
    .await
}

/// An agent whose own profile the run does not declare takes **no** turn: the loop ends on its
/// first pass with `internal_error`, one step ahead of the client resolution that ends a session
/// the same way for the same reason, and the diagnostic names the profile.
///
/// Running it as the root instead would have produced a complete, plausible, wholly fictional
/// session recorded under the name `Ghost`.
#[tokio::test]
async fn an_undeclared_incarnation_profile_ends_the_session_with_internal_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(
        dir.path(),
        GgCapabilitySet::minimal("mock/primary"),
        &emitter,
    );

    let end = drive_slot(
        orch,
        "Ghost",
        Box::new(MockClient::new("mock/primary".to_string(), Vec::new())),
    )
    .await;

    assert_eq!(
        end.status, STATUS_INTERNAL_ERROR,
        "an undeclared profile is gg's own defect, not a model or credential fault"
    );
    assert_eq!(
        end.turns, 0,
        "the agent must not take a turn as somebody else"
    );
    assert!(
        is_failure_status(end.status),
        "a run stopped by a gg defect is a failure, not a ceiling"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains("`Ghost`")
                && message.contains("not declared by this run")),
        "the diagnostic must name the profile that is missing: {errors:?}"
    );
}

/// The set the `exec` case runs on: a root that may `exec` into `After`, and **no `After`
/// profile** — the roster reference launch validation exists to reject.
fn dangling_roster_set() -> GgCapabilitySet {
    let mut root = GgAgentConfig {
        name: ROOT_AGENT.to_string(),
        model_id: "mock/exec-before".to_string(),
        subagents: vec![GgSubagentRef {
            agent: "After".to_string(),
            description: String::new(),
            scopes: ALL_SUBAGENT_SCOPES.to_vec(),
        }],
        ..GgAgentConfig::root()
    };
    root.capabilities = vec![
        GgCapabilityConfig::enabled(CAPABILITY_EXEC),
        GgCapabilityConfig::enabled(CAPABILITY_TASKS),
    ];
    // The profile replaces its capabilities wholesale, so it replaces the allowlists the default
    // came with: those name the *defaults'* calls, which this agent no longer has.
    crate::tools::grant_all(&mut root);
    GgCapabilitySet {
        agents: vec![root],
        ..GgCapabilitySet::default()
    }
}

/// A succession into a profile the run does not declare ends the session rather than succeeding
/// into whichever profile happens to be first.
///
/// The `exec` itself is accepted — its target is on the spawner's roster, which is all a handoff is
/// checked against — so this is the exact shape the defect takes in the wild: a reference that
/// looked legal to the model, resolving to nothing.
#[tokio::test]
async fn an_undeclared_successor_profile_ends_the_session_with_internal_error() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-exec-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), dangling_roster_set(), &emitter);

    let end = drive_slot(
        orch,
        ROOT_AGENT,
        Box::new(MockClient::with_exec_before_script("mock/exec-before")),
    )
    .await;

    assert_eq!(end.status, STATUS_INTERNAL_ERROR);
    assert!(
        end.handoff.is_none(),
        "a succession that cannot be resolved is not a succession the run performed"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains("`After`")
                && message.contains("not declared by this run")),
        "the diagnostic must name the successor that is missing: {errors:?}"
    );
}

/// A spawner whose own profile is undeclared has no roster to spawn from, and the delegation call
/// fails naming the defect instead of borrowing the root's allowlist — which would let one profile
/// spawn on another profile's authority.
#[test]
fn an_undeclared_spawner_profile_fails_the_delegation_call() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-spawn-ghost".to_string()), Box::new(sink.clone()));
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS)];
    let orch = orchestrator(dir.path(), set, &emitter);

    let spawner = Agent {
        slot: "Ghost".to_string(),
        ..Agent::root(ROOT_AGENT)
    };
    let outcome = resolve_delegation_target(&orch, &spawner, &json!({ "agent": ROOT_AGENT }))
        .expect_err("a spawner with no declared profile has no roster to check against");

    let rendered = format!("{outcome:?}");
    assert!(
        rendered.contains("`Ghost`") && rendered.contains("not declared by this run"),
        "the refusal must name the profile that is missing: {rendered}"
    );
}

/// The set the board case runs on: project management enabled, so the run has a live board.
fn board_set() -> GgCapabilitySet {
    let mut set = GgCapabilitySet::minimal("mock/primary");
    set.agents[0].capabilities = vec![GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)];
    crate::tools::grant_all(&mut set.agents[0]);
    set
}

/// File one issue **straight into the store**, assigned to `agent` and gated by `reviewers`.
///
/// Which is where the defect would have to originate: the board *tools* hold a filer to its own
/// implementers and its own reviewers, so no model can write either of the issues below.
fn file_issue(orch: &Orchestrator, agent: &str, reviewers: &[String]) -> String {
    orch.board
        .store()
        .lock()
        .expect("board store lock")
        .create_issue(NewIssue {
            title: "Wire the thing",
            description: None,
            in_scope: "the thing",
            out_of_scope: "everything else",
            completion_criteria: "the thing is wired",
            blocked_by: &[],
            epic_id: None,
            agent,
            reviewers,
        })
        .expect("the store files an issue whoever it names")
}

/// An issue assigned to a profile the run does not declare is **failed**, not dispatched under the
/// root.
///
/// Failing it is what an operator can act on: the issue turns red on the board they are watching,
/// its dependents are woken instead of hanging on it forever, and the reason names both the issue
/// and the assignee. Dispatching it under the root would have produced a green issue implemented by
/// an agent nobody asked for, which is the one outcome no one can detect.
#[tokio::test]
async fn an_issue_assigned_to_an_undeclared_profile_fails_rather_than_dispatching() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-issue-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), board_set(), &emitter);
    let issue_id = file_issue(&orch, "Ghost", &[]);

    orch.spawn_issue_agent(
        "agent-ghost-1".to_string(),
        issue_id.clone(),
        "Implement it.".to_string(),
        0,
        &emitter,
    );

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "an issue nobody declared can implement is failed, not quietly reassigned"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains(&issue_id) && message.contains("`Ghost`")),
        "the diagnostic must name both the issue and the assignee: {errors:?}"
    );
}

/// An issue whose reviewer is a profile the run does not declare is **failed**, not merged.
///
/// The assignee case one step further along the same board path, and the more dangerous half of it.
/// An assignee that cannot be resolved stalls an issue, which is visible; a reviewer that cannot be
/// resolved would simply vanish from it, and the issue its filer gated on a review would be
/// accepted and merged without one — carrying no review telemetry to say a gate was ever asked for.
#[tokio::test]
async fn an_issue_whose_reviewer_is_undeclared_fails_rather_than_merging() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-review-ghost".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), board_set(), &emitter);
    let issue_id = file_issue(&orch, ROOT_AGENT, &["Auditor".to_string()]);

    // The agent working the issue finished: everything from here is gg reconciling the board, which
    // is where the review it demanded either happens or is silently skipped.
    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Failed),
        "work whose gate resolves to nobody is not work that passed its gate"
    );
    let errors = error_messages(&sink.events());
    assert!(
        errors
            .iter()
            .any(|message| message.contains(&issue_id) && message.contains("`Auditor`")),
        "the diagnostic must name both the issue and the missing reviewer: {errors:?}"
    );
}

/// An issue that named no reviewers at all is accepted the moment its agent finishes.
///
/// The other half of the distinction above: naming nobody is a legitimate way to file an issue, so
/// the check on the reviewers an issue *did* name must not turn a board run without reviewers into
/// a board run that fails everything.
#[tokio::test]
async fn an_issue_that_named_no_reviewers_is_accepted_without_review() {
    let dir = TempDir::new().unwrap();
    let sink = CollectingSink::new();
    let emitter = Emitter::with_sink(Some("run-review-none".to_string()), Box::new(sink.clone()));
    let orch = orchestrator(dir.path(), board_set(), &emitter);
    let issue_id = file_issue(&orch, ROOT_AGENT, &[]);

    reconcile_issue(&orch, &issue_id, 0, true, &emitter).await;

    assert_eq!(
        orch.board.issue_status(&issue_id),
        Some(IssueStatus::Done),
        "an issue with nobody to gate it is accepted as soon as its agent finishes"
    );
    assert!(
        error_messages(&sink.events()).is_empty(),
        "an issue that named no reviewers reports no defect"
    );
}
