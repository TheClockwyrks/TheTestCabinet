//! The binding table: the five non-trivial creation paths, what retiring an agent does to the
//! barrier, and the record-preferring tool comparison.

use std::time::Duration;

use serde_json::json;
use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::gg_replay::{
    GG_REPLAY_STANDARD_TOOL_MAX_BYTES, GgReplayAgent, GgReplayEntry, GgReplayEntryKind,
    GgReplayInterner, GgReplayPools, GgReplayRecord, GgReplayToolCall, GgReplayToolOutcome,
    clip_text,
};

use super::*;
use crate::tools::ToolFailure;

/// A record with one provenance row per `(agent, origin)` and one recorded tool outcome per
/// `(agent, tool, output)`, assembled through the real [interner](GgReplayInterner) so the pools the
/// index reads are the pools an assembled record carries.
#[derive(Default)]
struct Builder {
    pools: GgReplayPools,
    agents: Vec<GgReplayAgent>,
    entries: Vec<GgReplayEntry>,
}

impl Builder {
    fn agent(mut self, agent_id: &str, origin: GgReplayAgentOrigin) -> Self {
        self.agents.push(GgReplayAgent {
            agent_id: agent_id.to_string(),
            profile: "Root".to_string(),
            origin,
            terminal_status: None,
            limit_hit: None,
        });
        self
    }

    /// One recorded tool outcome, interned under the capture's **tool** ceiling — which is what
    /// makes an over-long `output` come back as a clip, exactly as a standard capture records one.
    fn tool(mut self, agent: &str, seq: u64, name: &str, output: &str) -> Self {
        let output_index = self
            .pools
            .intern_text_clipped(output, Some(GG_REPLAY_STANDARD_TOOL_MAX_BYTES));
        let summary = self.pools.intern_text("done");
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind: GgReplayEntryKind::ToolResult {
                call: GgReplayToolCall {
                    id: format!("call_{seq}"),
                    name: name.to_string(),
                    arguments: json!({}),
                    cwd: None,
                },
                outcome: GgReplayToolOutcome {
                    ok: true,
                    output: output_index,
                    summary: Some(summary),
                    images: Vec::new(),
                    data: None,
                    data_text: None,
                    failure: None,
                },
            },
        });
        self
    }

    /// One recorded model call, purely so a barrier test has something for an agent to wait on.
    fn model(mut self, agent: &str, seq: u64) -> Self {
        let request = self.pools.intern_request(
            test_cabinet_core::gg_replay::GgClientRole::Agent,
            test_cabinet_core::gg_replay::GgReplayRequestShape::Complete,
            &[json!({ "role": "user", "content": format!("ask {seq}") })],
            None,
        );
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind: GgReplayEntryKind::ModelIo {
                request,
                response: json!({ "text": "ok", "toolCalls": [], "finishReason": "stop" }),
                duration_ms: None,
            },
        });
        self
    }

    /// One recorded `git` invocation — gg's own bookkeeping, which a playback re-runs for real and
    /// only *retires* here.
    fn git(mut self, agent: &str, seq: u64, command: &str) -> Self {
        let stdout = self.pools.intern_text("");
        let stderr = self.pools.intern_text("");
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind: GgReplayEntryKind::Git {
                command: test_cabinet_core::gg_replay::GgReplayCommand {
                    command: command.to_string(),
                    cwd: test_cabinet_core::gg_replay::GgShellCwd::Workspace,
                    exit_code: 0,
                    stdout,
                    stderr,
                },
            },
        });
        self
    }

    fn build(self) -> GgReplayRecord {
        let pooled = self.pools.into_parts();
        let mut record = GgReplayRecord::new("run-binding", GgCapabilitySet::minimal("mock/echo"));
        record.agents = self.agents;
        record.entries = self.entries;
        record.messages = pooled.messages;
        record.toolsets = pooled.toolsets;
        record.texts = pooled.texts;
        record.clips = pooled.clips;
        record.blobs = pooled.blobs;
        record
    }
}

/// The table over `record`, with the index and the ledger a test reads back.
fn table(record: GgReplayRecord) -> (Arc<AgentBindings>, Arc<ReplayInputs>, Arc<DriftLedger>) {
    let inputs = Arc::new(
        ReplayInputs::new(record)
            .expect("the record indexes")
            .with_stall_timeout(Duration::from_millis(20)),
    );
    let ledger = Arc::new(DriftLedger::new());
    let bindings = Arc::new(AgentBindings::new(Arc::clone(&inputs), Arc::clone(&ledger)));
    (bindings, inputs, ledger)
}

/// A successful tool outcome the loop would have produced.
fn outcome(output: &str) -> ToolOutcome {
    ToolOutcome {
        ok: true,
        output: output.to_string(),
        summary: Some("done".to_string()),
        images: Vec::new(),
        data: None,
        failure: None,
    }
}

/// The call that produced it.
fn call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        arguments: json!({}),
    }
}

// ---------------------------------------------------------------------------
// The five creation paths
// ---------------------------------------------------------------------------

/// Every creation path binds, and it binds on **provenance** rather than on an id — the live ids
/// here are deliberately nothing like the recorded ones, which is exactly what a reconstruction
/// that removed model latency produces.
///
/// The three board-dispatched rows are the reason the table exists at all: an issue attempt, a
/// reviewer and a merge agent are created with **no parent**, so a parent-keyed scheme leaves every
/// one of them unbindable — and an unbound agent dies on its first turn.
#[test]
fn all_five_creation_paths_bind_on_provenance_and_not_on_an_id() {
    let paths = [
        ("rec-root", GgReplayAgentOrigin::Root, "agent-9"),
        (
            "rec-spawn",
            GgReplayAgentOrigin::Spawn {
                parent: "rec-root".to_string(),
                ordinal: 1,
            },
            "agent-4",
        ),
        (
            "rec-succ",
            GgReplayAgentOrigin::Succession {
                predecessor: "rec-root".to_string(),
                ordinal: 0,
            },
            "agent-7",
        ),
        (
            "rec-issue",
            GgReplayAgentOrigin::IssueAttempt {
                issue: "AUTH-1".to_string(),
                attempt: 2,
            },
            "agent-1",
        ),
        (
            "rec-review",
            GgReplayAgentOrigin::Reviewer {
                issue: "AUTH-1".to_string(),
                round: 1,
                position: 0,
            },
            "agent-2",
        ),
        (
            "rec-merge",
            GgReplayAgentOrigin::Merge {
                issue: "AUTH-1".to_string(),
                ordinal: 0,
            },
            "agent-3",
        ),
    ];
    let mut builder = Builder::default();
    for (recorded, origin, _) in &paths {
        builder = builder.agent(recorded, origin.clone());
    }
    let (bindings, _inputs, ledger) = table(builder.build());

    for (_, origin, live) in &paths {
        bindings.agent_created(live, origin);
    }

    for (recorded, _, live) in &paths {
        assert_eq!(
            bindings.recorded_for_live(live).as_deref(),
            Some(*recorded),
            "the live agent `{live}` binds to `{recorded}`",
        );
        assert_eq!(
            bindings.live_for_recorded(recorded).as_deref(),
            Some(*live),
            "and the reverse direction answers too",
        );
    }
    assert!(ledger.drifts().is_empty(), "{:?}", ledger.drifts());
}

/// A provenance the record has no row for is a **reported** divergence, once, naming the live agent
/// and reading the origin as a sentence rather than a debug dump.
///
/// This is the shape a resolution that failed in the recorded run and succeeds here takes: a
/// missing credential cannot recur under a record, so the reconstruction gains a child the record
/// has no row for.
#[test]
fn an_origin_the_record_does_not_know_is_reported_against_the_live_agent() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .build(),
    );

    bindings.agent_created(
        "agent-5",
        &GgReplayAgentOrigin::Merge {
            issue: "AUTH-1".to_string(),
            ordinal: 0,
        },
    );

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::UnboundAgent);
    assert_eq!(drifts[0].agent_id, "agent-5");
    assert!(
        drifts[0].detail.contains("merge #0 of issue `AUTH-1`"),
        "the origin reads as a sentence: {}",
        drifts[0].detail,
    );
    assert!(
        !drifts[0].fatal,
        "that one agent ends; the reconstruction does not",
    );
    assert!(bindings.recorded_for_live("agent-5").is_none());
}

/// Two live agents claiming one recorded row is reported at the moment it happens: they would be
/// drawing from one queue and each being served the other's turns.
#[test]
fn two_live_agents_claiming_one_recorded_row_are_reported() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .build(),
    );

    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);
    bindings.agent_created("agent-1", &GgReplayAgentOrigin::Root);

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::UnboundAgent);
    assert!(drifts[0].detail.contains("agent-0"), "{drifts:?}");
    assert!(drifts[0].detail.contains("agent-1"), "{drifts:?}");
    assert_eq!(
        bindings.live_for_recorded("rec-root").as_deref(),
        Some("agent-0"),
        "the first binding stands; the later one is refused rather than overwriting it",
    );
}

// ---------------------------------------------------------------------------
// Retirement, and what it does to the barrier
// ---------------------------------------------------------------------------

/// An agent that ends retires its **recorded** queue, which is what turns a barrier wait behind its
/// leftovers into a provable deadlock rather than a half-minute timeout.
#[tokio::test]
async fn an_agent_that_ends_retires_its_recorded_queue() {
    let (bindings, inputs, _ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .agent(
                "rec-child",
                GgReplayAgentOrigin::Spawn {
                    parent: "rec-root".to_string(),
                    ordinal: 0,
                },
            )
            .model("rec-root", 0)
            .model("rec-child", 1)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);
    bindings.agent_created(
        "agent-1",
        &GgReplayAgentOrigin::Spawn {
            parent: "rec-root".to_string(),
            ordinal: 0,
        },
    );

    // The root ends without ever demanding seq 0, so nothing will serve it.
    bindings.agent_ended("agent-0");

    let err = inputs.await_turn("rec-child").await.unwrap_err();
    assert!(
        matches!(
            err,
            ReplayError::Deadlock {
                ref blocking_agent, ..
            } if blocking_agent == "rec-root",
        ),
        "the waiter is told what stopped it rather than waiting the ceiling out: {err:?}",
    );
}

// ---------------------------------------------------------------------------
// gg's own git: retired for the barrier's sake, compared for this build's
// ---------------------------------------------------------------------------

/// A real `git` invocation retires the recorded one it corresponds to, which is what puts an
/// issue's accept-and-merge back in the recorded order.
///
/// Nothing is served: the recorded result is not fed anywhere, and the reconstruction keeps its own.
/// What the retirement buys is the [barrier](ReplayInputs::await_turn) — the merge moves the board,
/// and the board is rendered into every agent's pinned prompt.
#[tokio::test]
async fn a_real_git_invocation_retires_the_recorded_one() {
    let (bindings, inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .agent(
                "rec-issue",
                GgReplayAgentOrigin::IssueAttempt {
                    issue: "A-1".to_string(),
                    attempt: 0,
                },
            )
            .git("rec-root", 0, "git merge --no-ff --no-edit gg/issue-A-1")
            .model("rec-issue", 1)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);
    bindings.agent_created(
        "agent-1",
        &GgReplayAgentOrigin::IssueAttempt {
            issue: "A-1".to_string(),
            attempt: 0,
        },
    );

    bindings.git_invoked("agent-0", "git merge --no-ff --no-edit gg/issue-A-1");

    assert!(ledger.drifts().is_empty(), "the same invocation");
    inputs
        .await_turn("rec-issue")
        .await
        .expect("the merge is no longer outstanding, so the next agent may take its turn");
}

/// The absolute paths gg's `git` puts on a command line are **not** part of the comparison.
///
/// A playback builds in a deliberately different directory, so a worktree add names a different
/// location every time. Reporting that would turn the relocation the whole design is built around
/// into a finding on every record that ever used a worktree.
#[tokio::test]
async fn a_relocated_worktree_path_is_not_a_changed_invocation() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .git(
                "rec-root",
                0,
                "git worktree add -q -b gg/issue-A-1 /run/one.gg-worktrees/issue-A-1 cafe1234",
            )
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    bindings.git_invoked(
        "agent-0",
        "git worktree add -q -b gg/issue-A-1 /tmp/playback/tree.gg-worktrees/issue-A-1 cafe1234",
    );

    assert!(
        ledger.drifts().is_empty(),
        "only the workspace moved: {:#?}",
        ledger.drifts(),
    );
}

/// A `git` invocation whose *shape* moved is reported — the flags and refs are a claim about this
/// build, not about where it ran.
#[tokio::test]
async fn a_git_invocation_this_build_changed_is_reported() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .git("rec-root", 0, "git merge --no-ff --no-edit gg/issue-A-1")
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    bindings.git_invoked("agent-0", "git merge --no-edit gg/issue-A-1");

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:#?}");
    assert_eq!(drifts[0].kind, DriftKind::GitInvocation);
    assert!(
        drifts[0].detail.contains("--no-ff"),
        "and it says what the record held: {}",
        drifts[0].detail,
    );
    assert!(
        !drifts[0].fatal,
        "reported, not fatal: the drift that matters surfaces on the next turn's conversation",
    );
}

/// Bookkeeping the record has nothing left for is reported rather than silently absorbed.
#[tokio::test]
async fn git_the_record_has_none_left_for_is_reported() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    bindings.git_invoked("agent-0", "git status --porcelain");

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:#?}");
    assert_eq!(drifts[0].kind, DriftKind::GitInvocation);
    assert!(
        drifts[0].detail.contains("bookkeeping the run did not"),
        "{}",
        drifts[0].detail,
    );
}

/// An agent the table could not place has no queue, and says so once — at its creation — rather than
/// once per `git` invocation it makes afterwards.
#[tokio::test]
async fn an_unbound_agents_git_does_not_report_again() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .build(),
    );
    bindings.agent_created(
        "agent-9",
        &GgReplayAgentOrigin::Spawn {
            parent: "rec-root".to_string(),
            ordinal: 0,
        },
    );
    let after_creation = ledger.drifts().len();

    bindings.git_invoked("agent-9", "git status --porcelain");

    assert_eq!(ledger.drifts().len(), after_creation);
}

/// A **succession** retires its predecessor, which no `agent_ended` ever will: a predecessor's loop
/// did not end, it continued as somebody else. The origin is the only thing that says so.
#[tokio::test]
async fn a_succession_retires_the_predecessor_that_handed_off() {
    let (bindings, inputs, _ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .agent(
                "rec-next",
                GgReplayAgentOrigin::Succession {
                    predecessor: "rec-root".to_string(),
                    ordinal: 0,
                },
            )
            .agent(
                "rec-other",
                GgReplayAgentOrigin::Spawn {
                    parent: "rec-root".to_string(),
                    ordinal: 0,
                },
            )
            .model("rec-root", 0)
            .model("rec-other", 1)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);
    bindings.agent_created(
        "agent-2",
        &GgReplayAgentOrigin::Spawn {
            parent: "rec-root".to_string(),
            ordinal: 0,
        },
    );
    // The successor's origin names the **live** predecessor, which is how the table finds the
    // recorded one to retire.
    bindings.agent_created(
        "agent-1",
        &GgReplayAgentOrigin::Succession {
            predecessor: "agent-0".to_string(),
            ordinal: 0,
        },
    );

    let err = inputs.await_turn("rec-other").await.unwrap_err();
    assert!(
        matches!(
            err,
            ReplayError::Deadlock {
                ref blocking_agent, ..
            } if blocking_agent == "rec-root",
        ),
        "the predecessor never consumes again, and the barrier knows it: {err:?}",
    );
}

// ---------------------------------------------------------------------------
// Tool re-execution, compared, with the record preferred
// ---------------------------------------------------------------------------

/// A re-executed tool that answers the same thing is not a divergence, and the record is what is
/// fed forward either way.
#[tokio::test]
async fn an_identical_tool_outcome_is_not_a_divergence() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .tool("rec-root", 0, "read_file", "the file's contents")
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    let mut live = outcome("the file's contents");
    bindings
        .tool_completed("agent-0", &call("call_0", "read_file"), &mut live)
        .await;

    assert!(ledger.drifts().is_empty(), "{:?}", ledger.drifts());
    assert_eq!(live.output, "the file's contents");
}

/// A re-executed tool that answers **differently** is reported, and the **recorded** outcome is fed
/// forward — which is what keeps the reconstructed context window equal to the recorded one, the
/// entire basis on which anything extracted from a playback is valid.
///
/// The archetypal case is exactly this one: reading a file a *shell* command created in the real
/// run, which the stubbed shell created nothing of.
#[tokio::test]
async fn a_tool_that_answers_differently_is_reported_and_the_record_wins() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .tool("rec-root", 0, "read_file", "what the run's build produced")
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    let mut live = outcome("(no such file)");
    bindings
        .tool_completed("agent-0", &call("call_0", "read_file"), &mut live)
        .await;

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::ToolResult);
    assert!(drifts[0].detail.contains("the output moved"), "{drifts:?}");
    assert_eq!(
        live.output, "what the run's build produced",
        "the record wins, so the next turn's conversation is still the run's",
    );
}

/// A failure class that moved is caught even when the text did not — the model is told a refusal
/// and an I/O error differently, so they are different outcomes.
#[tokio::test]
async fn a_failure_class_that_moved_is_a_divergence() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .tool("rec-root", 0, "read_file", "same text")
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    let mut live = ToolOutcome {
        failure: Some(ToolFailure::Refused),
        ..outcome("same text")
    };
    bindings
        .tool_completed("agent-0", &call("call_0", "read_file"), &mut live)
        .await;

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::ToolResult);
    assert!(drifts[0].detail.contains("failure class"), "{drifts:?}");
}

/// A **clipped** record inverts the preference: the record holds only a tail, the message pool holds
/// what the model was shown whole, and feeding the tail forward would diverge the very conversation
/// the preference exists to protect. When the live payload's content address matches the clip's, the
/// two are the same text and this build has the complete copy — so the live outcome stands, with no
/// divergence reported.
#[tokio::test]
async fn a_clipped_record_keeps_the_live_payload_when_the_two_are_the_same_text() {
    let long = "x".repeat(GG_REPLAY_STANDARD_TOOL_MAX_BYTES + 4_096);
    assert!(
        clip_text(&long, GG_REPLAY_STANDARD_TOOL_MAX_BYTES).is_some(),
        "the fixture really is over the ceiling a standard capture clips at",
    );
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .tool("rec-root", 0, "read_file", &long)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    let mut live = outcome(&long);
    bindings
        .tool_completed("agent-0", &call("call_0", "read_file"), &mut live)
        .await;

    assert!(ledger.drifts().is_empty(), "{:?}", ledger.drifts());
    assert_eq!(
        live.output.len(),
        long.len(),
        "the whole payload is fed forward, not the tail the record could carry",
    );
}

/// A clipped record whose live payload does **not** match is the one case nothing can be checked
/// against, so it is reported as a hole in the record rather than as a change in this build — and it
/// names the fix.
#[tokio::test]
async fn a_clipped_record_that_cannot_be_verified_says_so() {
    let long = "x".repeat(GG_REPLAY_STANDARD_TOOL_MAX_BYTES + 4_096);
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .tool("rec-root", 0, "read_file", &long)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    let mut live = outcome("something else entirely");
    bindings
        .tool_completed("agent-0", &call("call_0", "read_file"), &mut live)
        .await;

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::ClippedRecord);
    assert!(drifts[0].detail.contains("full fidelity"), "{drifts:?}");
    assert_eq!(
        live.output, "something else entirely",
        "a tail is strictly worse than this build's own whole answer",
    );
}

/// A tool call the record has no outcome left for is reported rather than silently accepted: what
/// the next turn is shown is this reconstruction's rather than the run's, and that is exactly the
/// kind of thing the report exists to say.
#[tokio::test]
async fn a_tool_the_record_has_no_outcome_left_for_is_reported() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .build(),
    );
    bindings.agent_created("agent-0", &GgReplayAgentOrigin::Root);

    let mut live = outcome("this build's answer");
    bindings
        .tool_completed("agent-0", &call("call_0", "write_file"), &mut live)
        .await;

    let drifts = ledger.drifts();
    assert_eq!(drifts.len(), 1, "{drifts:?}");
    assert_eq!(drifts[0].kind, DriftKind::ToolResult);
    assert!(drifts[0].detail.contains("write_file"), "{drifts:?}");
    assert_eq!(live.output, "this build's answer");
}

/// A tool call from an agent the table could not bind reports **nothing** here: its binding failure
/// was already reported once, at its creation, and one divergence per tool call of an agent nobody
/// could answer would drown the report it belongs in.
#[tokio::test]
async fn an_unbound_agents_tool_calls_do_not_each_report_again() {
    let (bindings, _inputs, ledger) = table(
        Builder::default()
            .agent("rec-root", GgReplayAgentOrigin::Root)
            .build(),
    );

    let mut live = outcome("whatever");
    for _ in 0..3 {
        bindings
            .tool_completed("agent-9", &call("call_0", "read_file"), &mut live)
            .await;
    }

    assert!(ledger.drifts().is_empty(), "{:?}", ledger.drifts());
}
