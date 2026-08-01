//! The shared replay index: the cursors, the pool rehydration, and the ordering barrier.
//!
//! The barrier tests are the load-bearing ones. Two of them
//! ([`the_barrier_yields_so_another_agent_can_advance`] and
//! [`the_barrier_serves_three_agents_in_recorded_seq_order`]) drive **several futures inside one
//! task**, which is the shape a `current_thread` runtime running every gg agent actually has: if
//! [`await_turn`](ReplayInputs::await_turn) ever spun instead of parking, the sibling future would
//! never be polled and the test would hang rather than fail. That is the honest failure mode for
//! "the wait must yield", and it is why the property is tested this way rather than by inspecting
//! the code.

use std::time::Duration;

use serde_json::json;
use test_cabinet_core::gg::{GgCapabilitySet, GgContextSource};
use test_cabinet_core::gg_replay::{
    GgClientRole, GgReplayCommand, GgReplayEntry, GgReplayEntryKind, GgReplayInterner,
    GgReplayModelError, GgReplayModelErrorKind, GgReplayPools, GgReplayPromptItem,
    GgReplayPromptSlot, GgReplayRequestShape, GgReplayRetention, GgReplayToolCall,
    GgReplayToolOutcome,
};

use super::*;
use crate::model::FinishReason;
use crate::tools::ToolFailure;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/// A record assembled through the real [interner](GgReplayInterner), so the pools the index reads
/// are the pools an assembled record carries.
#[derive(Default)]
struct Builder {
    pools: GgReplayPools,
    entries: Vec<GgReplayEntry>,
}

impl Builder {
    fn push(&mut self, agent: &str, seq: u64, kind: GgReplayEntryKind) -> &mut Self {
        self.entries.push(GgReplayEntry {
            agent_id: agent.to_string(),
            seq,
            kind,
        });
        self
    }

    fn model(&mut self, agent: &str, seq: u64, text: &str) -> &mut Self {
        let request = self.pools.intern_request(
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            &[json!({ "role": "user", "content": format!("ask {seq}") })],
            None,
        );
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ModelIo {
                request,
                response: serde_json::to_value(response(text)).unwrap(),
                duration_ms: Some(1_234),
            },
        )
    }

    fn model_error(&mut self, agent: &str, seq: u64) -> &mut Self {
        let request = self.pools.intern_request(
            GgClientRole::Compaction,
            GgReplayRequestShape::CompleteRequiring,
            &[json!({ "role": "system", "content": "summarize" })],
            Some(&json!([{ "name": "handoff" }])),
        );
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ModelError {
                request,
                error: GgReplayModelError {
                    kind: GgReplayModelErrorKind::RetryExhausted,
                    message: "upstream 503".to_string(),
                    status: Some(503),
                    attempts: Some(5),
                    model_id: Some("mock/echo".to_string()),
                },
                duration_ms: None,
            },
        )
    }

    fn tool(&mut self, agent: &str, seq: u64, name: &str) -> &mut Self {
        let output = self.pools.intern_text(&format!("{name} output"));
        let summary = self.pools.intern_text(&format!("ran {name}"));
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ToolResult {
                call: GgReplayToolCall {
                    id: format!("call-{seq}"),
                    name: name.to_string(),
                    arguments: json!({ "path": "a.txt" }),
                    cwd: Some(GgShellCwd::Relative {
                        path: "web".to_string(),
                    }),
                },
                outcome: GgReplayToolOutcome {
                    ok: true,
                    output,
                    summary: Some(summary),
                    images: Vec::new(),
                    data: None,
                    failure: None,
                },
            },
        )
    }

    /// A failed tool result carrying an image and a classified failure — the payload shapes the
    /// index has to rebuild rather than pass through.
    fn rich_tool(&mut self, agent: &str, seq: u64) -> &mut Self {
        let output = self.pools.intern_text("could not read the mockup");
        let blob = self.pools.intern_blob("image/png", 12, "aGVsbG8=");
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ToolResult {
                call: GgReplayToolCall {
                    id: "call-rich".to_string(),
                    name: "read_file".to_string(),
                    arguments: json!({ "path": "mock.png" }),
                    cwd: None,
                },
                outcome: GgReplayToolOutcome {
                    ok: false,
                    output,
                    summary: None,
                    images: vec![blob],
                    data: None,
                    failure: Some(serde_json::to_value(ToolFailure::NotFound).unwrap()),
                },
            },
        )
    }

    fn git(&mut self, agent: &str, seq: u64, command: &str) -> &mut Self {
        let command = self.command(command, "cafe1234");
        self.push(agent, seq, GgReplayEntryKind::Git { command })
    }

    fn shell(&mut self, agent: &str, seq: u64, command: &str) -> &mut Self {
        let command = self.command(command, "built");
        self.push(
            agent,
            seq,
            GgReplayEntryKind::Shell {
                origin: GgShellOrigin::CompletionValidation,
                command,
            },
        )
    }

    fn command(&mut self, command: &str, stdout: &str) -> GgReplayCommand {
        GgReplayCommand {
            command: command.to_string(),
            cwd: GgShellCwd::Workspace,
            exit_code: 0,
            stdout: self.pools.intern_text(stdout),
            stderr: self.pools.intern_text(""),
        }
    }

    fn clock(&mut self, agent: &str, seq: u64, elapsed_ms: u64) -> &mut Self {
        self.push(
            agent,
            seq,
            GgReplayEntryKind::Clock {
                elapsed_ms,
                remaining_ms: Some(60_000),
            },
        )
    }

    fn probe(&mut self, agent: &str, seq: u64, canceled: bool) -> &mut Self {
        self.push(agent, seq, GgReplayEntryKind::CancelProbe { canceled })
    }

    fn frame(&mut self, agent: &str, seq: u64) -> &mut Self {
        let message = self.pools.intern_message(&json!({
            "role": "system",
            "content": "you are gg",
        }));
        self.push(
            agent,
            seq,
            GgReplayEntryKind::PromptFrame {
                items: vec![GgReplayPromptItem {
                    message,
                    slot: GgReplayPromptSlot::System,
                    source: GgContextSource::System,
                    retention: GgReplayRetention::Pinned,
                    turn: 1,
                    label: None,
                    region: None,
                }],
            },
        )
    }

    fn build(&mut self) -> GgReplayRecord {
        let pools = std::mem::take(&mut self.pools).into_parts();
        let mut record = GgReplayRecord::new("run-inputs", GgCapabilitySet::minimal("mock/echo"));
        record.messages = pools.messages;
        record.toolsets = pools.toolsets;
        record.texts = pools.texts;
        record.clips = pools.clips;
        record.blobs = pools.blobs;
        record.entries = std::mem::take(&mut self.entries);
        record
    }
}

fn response(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: test_cabinet_core::metrics::TokenCounts::default(),
        cost: None,
    }
}

/// A tiny stall ceiling, so the [stall](ReplayStall) path is exercised in milliseconds rather than
/// in the half-minute a real reconstruction is given.
fn impatient(record: GgReplayRecord) -> ReplayInputs {
    ReplayInputs::new(record)
        .expect("indexes")
        .with_stall_timeout(Duration::from_millis(20))
}

// ---------------------------------------------------------------------------
// The cursors
// ---------------------------------------------------------------------------

/// Each category is its own per-agent queue, handed back in recorded order — and one agent's
/// entries never leak into another's.
#[test]
fn each_agent_reads_its_own_inputs_in_recorded_order() {
    let record = Builder::default()
        .model("root", 0, "first")
        .model("agent-0", 1, "child")
        .tool("root", 2, "write_file")
        .git("root", 3, "git status")
        .tool("root", 4, "shell")
        .model("root", 5, "second")
        .build();
    let inputs = ReplayInputs::new(record).expect("indexes");

    assert_eq!(inputs.agent_ids(), ["root", "agent-0"]);

    // The model queue skips over this agent's tool and git entries — categories are independent.
    let first = inputs.next_model("root").expect("a first model call");
    assert_eq!(first.seq, 0);
    assert_eq!(first.duration_ms, Some(1_234));
    let RecordedModelOutcome::Response(response) = &first.outcome else {
        panic!("a successful call");
    };
    assert_eq!(response.text.as_deref(), Some("first"));
    assert_eq!(inputs.next_model("root").expect("a second").seq, 5);

    // The other agent's one call is untouched by any of that.
    assert_eq!(inputs.next_model("agent-0").expect("the child's").seq, 1);

    let tools: Vec<String> = (0..2)
        .map(|_| inputs.next_tool("root").expect("a tool result").call.name)
        .collect();
    assert_eq!(tools, ["write_file", "shell"]);
    assert_eq!(inputs.next_git("root").expect("the git run").seq, 3);
}

/// A cursor that runs out says which agent asked for what, rather than handing back a default.
#[test]
fn an_exhausted_cursor_names_the_agent_and_the_kind() {
    let inputs =
        ReplayInputs::new(Builder::default().model("root", 0, "only").build()).expect("indexes");
    inputs.next_model("root").expect("the one call");

    assert_eq!(
        inputs.next_model("root").unwrap_err(),
        ReplayError::Exhausted {
            agent_id: "root".to_string(),
            kind: RecordedInputKind::Model,
        },
    );
    // An agent the record never mentions is the same answer, not a panic.
    assert_eq!(
        inputs.next_probe("ghost").unwrap_err(),
        ReplayError::Exhausted {
            agent_id: "ghost".to_string(),
            kind: RecordedInputKind::CancelProbe,
        },
    );
    assert!(
        inputs
            .next_tool("root")
            .unwrap_err()
            .to_string()
            .contains("tool"),
        "the message names the category",
    );
}

/// A pooled tool outcome is rebuilt into the gg type the loop feeds forward — text out of the text
/// pool, images out of the blob pool, the classified failure parsed back.
#[test]
fn a_tool_outcome_is_rehydrated_out_of_the_pools() {
    let inputs =
        ReplayInputs::new(Builder::default().rich_tool("root", 0).build()).expect("indexes");

    let served = inputs.next_tool("root").expect("the outcome");
    assert!(!served.outcome.ok);
    assert_eq!(served.outcome.output, "could not read the mockup");
    assert_eq!(served.outcome.summary, None);
    assert_eq!(served.outcome.failure, Some(ToolFailure::NotFound));
    assert_eq!(served.outcome.images.len(), 1);
    assert_eq!(served.outcome.images[0].media_type, "image/png");
    assert_eq!(served.outcome.images[0].data_base64, "aGVsbG8=");
    assert_eq!(served.outcome.images[0].bytes, 12);
    assert_eq!(served.call.name, "read_file");
    assert_eq!(served.cwd, None);
}

/// A subprocess comes back with its streams resolved and its origin intact — `git` is not one of the
/// three shell paths and says so by carrying no origin.
#[test]
fn a_subprocess_carries_its_origin_and_its_resolved_streams() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .git("root", 0, "git diff")
            .shell("root", 1, "npm run build")
            .build(),
    )
    .expect("indexes");

    let git = inputs.next_git("root").expect("the git run");
    assert_eq!(git.origin, None);
    assert_eq!(git.command, "git diff");
    assert_eq!(git.stdout, "cafe1234");
    assert_eq!(git.cwd, GgShellCwd::Workspace);

    let shell = inputs.next_shell("root").expect("the shell run");
    assert_eq!(shell.origin, Some(GgShellOrigin::CompletionValidation));
    assert_eq!(shell.command, "npm run build");
    assert_eq!(shell.stdout, "built");
}

/// The turn-boundary probes report the values the run observed.
#[test]
fn the_probes_report_what_the_run_observed() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .clock("root", 0, 90_000)
            .probe("root", 1, true)
            .build(),
    )
    .expect("indexes");

    let clock = inputs.next_clock("root").expect("the clock read");
    assert_eq!(clock.elapsed_ms, 90_000);
    assert_eq!(clock.remaining_ms, Some(60_000));
    assert!(inputs.next_probe("root").expect("the cancel read").canceled);
}

/// A failed model call comes off the **same** queue as a successful one, carrying the error the loop
/// branched on. A separate queue would let a reconstruction answer a turn from a call that failed.
#[test]
fn a_failed_call_is_served_from_the_model_queue() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .model_error("root", 0)
            .model("root", 1, "the retry")
            .build(),
    )
    .expect("indexes");

    let failed = inputs.next_model("root").expect("the failed call");
    assert_eq!(failed.request.role, GgClientRole::Compaction);
    assert_eq!(
        failed.request.shape,
        GgReplayRequestShape::CompleteRequiring
    );
    let RecordedModelOutcome::Failed(error) = &failed.outcome else {
        panic!("a failed call");
    };
    assert_eq!(error.kind, GgReplayModelErrorKind::RetryExhausted);
    assert_eq!(error.status, Some(503));

    let retried = inputs.next_model("root").expect("the retry");
    assert!(matches!(retried.outcome, RecordedModelOutcome::Response(_)));
}

/// Prompt frames are indexed but never consumed: they are what the window **was**, which a
/// reconstruction compares against rather than reads.
#[test]
fn prompt_frames_are_indexed_but_not_consumed() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .model("root", 0, "answering")
            .frame("root", 1)
            .build(),
    )
    .expect("indexes");

    let frames = inputs.prompt_frames("root");
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].seq, 1);
    assert_eq!(frames[0].items[0].slot, GgReplayPromptSlot::System);
    assert!(inputs.prompt_frames("nobody").is_empty());

    // Serving the model call is the whole of the barrier's work: the frame is not an input.
    inputs.next_model("root").expect("the call");
    assert_eq!(inputs.unserved(), 0);
}

/// A pooled message resolves back to the body the client sent, and a resolved request reads as the
/// conversation rather than as a list of pool indices.
#[test]
fn a_pooled_message_resolves_to_its_body() {
    let inputs =
        ReplayInputs::new(Builder::default().model("root", 0, "hi").build()).expect("indexes");
    let call = inputs.next_model("root").expect("the call");
    let body = inputs
        .message(call.request.messages[0])
        .expect("the pooled body");
    assert_eq!(body["content"], "ask 0");
    assert_eq!(inputs.message(404), None);

    let view = inputs.request_view(&call.request);
    assert_eq!(view["messages"][0]["content"], "ask 0");
    assert_eq!(view["tools"], serde_json::Value::Null);
    // The seed travels with the index even while assembly leaves it empty.
    assert_eq!(inputs.seed().prompt, String::new());
}

// ---------------------------------------------------------------------------
// The ordering barrier
// ---------------------------------------------------------------------------

/// An agent with nothing recorded left never blocks: it is doing work the record does not pin, and
/// gating that would serialize a reconstruction for no reason.
#[tokio::test]
async fn an_agent_with_nothing_left_never_waits() {
    let inputs = impatient(Builder::default().model("root", 0, "only").build());
    inputs.next_model("root").expect("its one call");
    inputs.await_turn("root").await.expect("does not block");
    inputs.await_turn("never-ran").await.expect("nor does this");
}

/// The barrier **yields**: an agent parked behind a lower entry lets the agent that owes it run.
///
/// Both halves are driven as two futures in one task, which is what gg's `current_thread` runtime
/// gives every agent. A wait that spun rather than parking would never yield control back, the
/// server half would never be polled, and this would hang — which is the failure this asserts
/// against.
#[tokio::test]
async fn the_barrier_yields_so_another_agent_can_advance() {
    let inputs = impatient(
        Builder::default()
            .model("root", 0, "first")
            .model("agent-0", 1, "second")
            .build(),
    );

    let waiter = async {
        // agent-0's next input is seq 1, and seq 0 is still outstanding.
        inputs.await_turn("agent-0").await.expect("released");
        inputs.next_model("agent-0").expect("its call").seq
    };
    let server = async {
        // Nothing in here awaits: it can only run if the waiter parked.
        inputs.next_model("root").expect("the root's call").seq
    };
    let (waited, served) = tokio::join!(waiter, server);
    assert_eq!(served, 0);
    assert_eq!(waited, 1);
    assert!(inputs.stalls().is_empty(), "nothing stalled");
}

/// Three agents, one interleaving: each is released only when every lower recorded input has been
/// served, so the order inputs are handed out in is the order they were recorded in — whatever order
/// the agents happen to ask in.
#[tokio::test]
async fn the_barrier_serves_three_agents_in_recorded_seq_order() {
    let inputs = impatient(
        Builder::default()
            .model("c", 0, "c first")
            .model("b", 1, "b second")
            .model("a", 2, "a third")
            .build(),
    );
    let served: Mutex<Vec<u64>> = Mutex::new(Vec::new());

    // Deliberately started in the *reverse* of the recorded order.
    let take = |agent: &'static str| async {
        inputs.await_turn(agent).await.expect("released");
        let call = inputs.next_model(agent).expect("its call");
        served.lock().expect("served lock").push(call.seq);
    };
    tokio::join!(take("a"), take("b"), take("c"));

    assert_eq!(
        served.into_inner().expect("served lock"),
        vec![0, 1, 2],
        "recorded order, not arrival order",
    );
}

/// A waiter behind an entry a **retired** agent owes is told so rather than left parked: nobody will
/// ever serve it, so waiting longer cannot help.
#[tokio::test]
async fn a_retired_agent_deadlocks_everyone_behind_it() {
    let inputs = impatient(
        Builder::default()
            .model("root", 0, "never demanded")
            .model("agent-0", 1, "waiting on it")
            .build(),
    );
    inputs.retire("root");

    let err = inputs.await_turn("agent-0").await.unwrap_err();
    assert_eq!(
        err,
        ReplayError::Deadlock {
            agent_id: "agent-0".to_string(),
            seq: 1,
            blocking_agent: "root".to_string(),
            blocking_seq: 0,
        },
    );
    assert!(err.to_string().contains("no agent can advance"), "{err}");
}

/// A live agent that simply never demands its recorded input is a **stall**, not a deadlock: the
/// lowest waiter is released after the ceiling, the inputs it stepped over are abandoned, and the
/// whole thing is reported.
#[tokio::test]
async fn an_undemanded_input_stalls_and_releases_the_lowest_waiter() {
    let inputs = impatient(
        Builder::default()
            .model("root", 0, "never demanded")
            .model("agent-0", 1, "waiting on it")
            .build(),
    );

    // `root` is live and simply never asks, so nothing below seq 1 will ever be served.
    inputs
        .await_turn("agent-0")
        .await
        .expect("released by the ceiling");
    assert_eq!(
        inputs.stalls(),
        vec![ReplayStall {
            agent_id: "agent-0".to_string(),
            seq: 1,
            abandoned: vec![0],
        }],
    );
    // Released for good: the abandoned entry does not stall the next waiter all over again.
    inputs.next_model("agent-0").expect("its call");
    inputs
        .await_turn("agent-0")
        .await
        .expect("nothing left to wait for");
}

/// Retiring an agent releases the waiters it was blocking straight away, rather than making them
/// serve out the stall ceiling.
#[tokio::test]
async fn retiring_wakes_a_waiter_immediately() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .model("root", 0, "never demanded")
            .model("agent-0", 1, "waiting on it")
            .build(),
    )
    .expect("indexes")
    // A ceiling far beyond the test's patience: the only thing that can release the waiter here is
    // the retirement.
    .with_stall_timeout(Duration::from_secs(600));

    let waiter = async { inputs.await_turn("agent-0").await };
    let retirer = async { inputs.retire("root") };
    let (result, ()) = tokio::join!(waiter, retirer);
    assert!(
        matches!(
            result,
            Err(ReplayError::Deadlock {
                blocking_seq: 0,
                ..
            })
        ),
        "expected an immediate deadlock, got {result:?}",
    );
}

/// A prompt frame does not gate the barrier. It is nobody's input, so an agent waiting behind one
/// would wait forever.
#[tokio::test]
async fn a_prompt_frame_does_not_gate_the_barrier() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .frame("root", 0)
            .model("agent-0", 1, "behind the frame")
            .build(),
    )
    .expect("indexes")
    // Long enough that a release here could only come from the gate, never from the ceiling.
    .with_stall_timeout(Duration::from_secs(600));

    inputs.await_turn("agent-0").await.expect("not gated");
    assert!(inputs.stalls().is_empty(), "and not by stalling either");
}
