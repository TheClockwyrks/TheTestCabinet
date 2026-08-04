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
    GgClientRole, GgReplayAgent, GgReplayAgentOrigin, GgReplayCommand, GgReplayEntry,
    GgReplayEntryKind, GgReplayInterner, GgReplayModelError, GgReplayModelErrorKind, GgReplayPools,
    GgReplayPromptItem, GgReplayPromptSlot, GgReplayRequestShape, GgReplayRetention,
    GgReplayToolCall, GgReplayToolOutcome,
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
    agents: Vec<GgReplayAgent>,
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
                    data_text: None,
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
                    data_text: None,
                    failure: Some(serde_json::to_value(ToolFailure::NotFound).unwrap()),
                },
            },
        )
    }

    /// A `read_file` whose body was **clipped** by a standard capture and whose structured payload
    /// had that same body [lifted into the text pool](GgReplayToolOutcome::data_text) — the two
    /// things the recorder does to a large read, together, because they are what a playback has to
    /// undo and to notice.
    fn clipped_read(&mut self, agent: &str, seq: u64, body: &str, max_bytes: usize) -> &mut Self {
        let output = self.pools.intern_text_clipped(body, Some(max_bytes));
        let data_text = self.pools.intern_text_clipped(body, Some(max_bytes));
        let data = serde_json::to_value(ToolData::FileText(crate::tools::FileTextData {
            // Emptied on the recording path: the body lives in the pool now.
            contents: String::new(),
            first_line: 1,
            last_line: 9,
            total_lines: 9,
            byte_truncated: true,
        }))
        .unwrap();
        self.push(
            agent,
            seq,
            GgReplayEntryKind::ToolResult {
                call: GgReplayToolCall {
                    id: "call-clipped".to_string(),
                    name: "read_file".to_string(),
                    arguments: json!({ "path": "big.ts" }),
                    cwd: None,
                },
                outcome: GgReplayToolOutcome {
                    ok: true,
                    output,
                    summary: None,
                    images: Vec::new(),
                    data: Some(data),
                    data_text: Some(data_text),
                    failure: None,
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

    /// A shell command whose stdout a standard capture clipped — a build log, the archetype.
    fn clipped_shell(
        &mut self,
        agent: &str,
        seq: u64,
        stdout: &str,
        max_bytes: usize,
    ) -> &mut Self {
        let command = GgReplayCommand {
            command: "npm run build".to_string(),
            cwd: GgShellCwd::Workspace,
            exit_code: 0,
            stdout: self.pools.intern_text_clipped(stdout, Some(max_bytes)),
            stderr: self.pools.intern_text(""),
        };
        self.push(
            agent,
            seq,
            GgReplayEntryKind::Shell {
                origin: GgShellOrigin::CompletionValidation,
                command,
            },
        )
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

    /// Add one row to the record's [provenance table](GgReplayRecord::agents), in creation
    /// order — the table an assembled record carries, independently of what the agent recorded.
    fn agent(&mut self, agent_id: &str, origin: GgReplayAgentOrigin) -> &mut Self {
        self.agents.push(GgReplayAgent {
            agent_id: agent_id.to_string(),
            profile: "Worker".to_string(),
            origin,
            terminal_status: None,
            limit_hit: None,
        });
        self
    }

    fn build(&mut self) -> GgReplayRecord {
        let pools = std::mem::take(&mut self.pools).into_parts();
        let mut record = GgReplayRecord::new("run-inputs", GgCapabilitySet::minimal("mock/echo"));
        record.agents = std::mem::take(&mut self.agents);
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
        loop_aborts: 0,
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

/// The agent set comes from the record's **[provenance table](GgReplayRecord::agents)**, so an
/// agent that ran and pinned nothing is still one of the run's agents.
///
/// This is the case deriving the set from the entries gets wrong, and it is not a corner: an agent
/// parked behind the parallelism cap when the run was killed, or one whose first model call never
/// returned, appears in the table and nowhere else. A reconstruction that learned its agents from
/// the entries would quietly run a smaller fleet than the run did — and the divergence it reported
/// would be about the work the missing agent never got asked to do.
#[test]
fn an_agent_the_table_names_but_no_entry_mentions_is_still_one_of_the_runs_agents() {
    let record = Builder::default()
        .agent("root", GgReplayAgentOrigin::Root)
        .agent(
            "agent-0",
            GgReplayAgentOrigin::Spawn {
                parent: "root".to_string(),
                ordinal: 0,
            },
        )
        .model("root", 0, "the only call anybody made")
        .build();
    assert!(
        record.entries.iter().all(|entry| entry.agent_id == "root"),
        "the premise: the spawned agent pinned nothing at all",
    );

    let inputs = ReplayInputs::new(record).expect("indexes");

    assert_eq!(
        inputs.agent_ids(),
        ["root", "agent-0"],
        "both agents, in the order the run created them",
    );
    // And it is a real, empty queue rather than an unknown agent: asking for an input it never
    // recorded is exhaustion, which is what a reconstruction of it has to see.
    assert_eq!(
        inputs.next_model("agent-0").unwrap_err(),
        ReplayError::Exhausted {
            agent_id: "agent-0".to_string(),
            kind: RecordedInputKind::Model,
        },
    );
}

/// A record captured **before** the provenance table existed still yields every agent its entries
/// mention, and one the table missed is folded in after the ones it named.
///
/// The table is the better source, never the only one: the fallback is what keeps every record
/// written by a pre-M7.5 gg readable rather than agent-less.
#[test]
fn an_agent_only_the_entries_mention_is_folded_in_after_the_table() {
    let record = Builder::default()
        .agent("root", GgReplayAgentOrigin::Root)
        .model("agent-0", 0, "an agent the table never named")
        .model("root", 1, "the root's own")
        .build();

    let inputs = ReplayInputs::new(record).expect("indexes");

    assert_eq!(
        inputs.agent_ids(),
        ["root", "agent-0"],
        "the table first, then whatever only the entries knew about",
    );
    assert_eq!(inputs.next_model("agent-0").expect("its call").seq, 0);
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

/// A clipped payload is served **as a clip**, not as a payload: the index hands back the tail it
/// has *and* the record of what is missing, on both the tool seam and the subprocess seam.
///
/// This is the difference between a loud failure and a silent one. A playback feeding a clipped
/// outcome back to the model hands it a tail of what the run handed it, so the turn's content
/// address diverges — and a consumer that cannot see the clip reports that as the model having
/// answered differently, which is the one question the reconstruction exists to settle. The clip
/// also carries the whole payload's content address, so a consumer that re-executes the call can
/// still check its result exactly.
#[test]
fn a_clipped_payload_says_what_it_is_missing() {
    let body = "z".repeat(4_096);
    let log = "build log\n".repeat(500);
    let record = Builder::default()
        .clipped_read("root", 0, &body, 1_024)
        .clipped_shell("root", 1, &log, 512)
        .build();
    let inputs = ReplayInputs::new(record).expect("indexes");

    let served = inputs.next_tool("root").expect("the outcome");
    assert_eq!(
        served.outcome.output.len(),
        1_024,
        "the tail is what is held"
    );
    let clip = served.output_clip.expect("a clipped outcome says so");
    assert_eq!(clip.original_bytes, body.len() as u64);
    assert_eq!(
        clip.original_id,
        test_cabinet_core::gg_replay::fingerprint_exact(body.as_bytes())
    );

    let subprocess = inputs.next_shell("root").expect("the command");
    assert_eq!(subprocess.stdout.len(), 512);
    assert_eq!(
        subprocess
            .stdout_clip
            .expect("a clipped stream says so")
            .original_bytes,
        log.len() as u64,
    );
    // The stream that was never clipped carries no clip, so `Some` genuinely means "cut here"
    // rather than "this seam clips".
    assert_eq!(subprocess.stderr_clip, None);
}

/// The body the recorder lifted out of a `read_file`'s structured payload is put back where it came
/// from, so the loop is handed the same `ToolData` the run produced rather than one with its
/// largest field empty.
#[test]
fn a_lifted_payload_is_restored_into_its_structured_data() {
    let body = "contents that were pooled";
    let record = Builder::default()
        .clipped_read("root", 0, body, 1_024)
        .build();
    let inputs = ReplayInputs::new(record).expect("indexes");

    let served = inputs.next_tool("root").expect("the outcome");
    let Some(ToolData::FileText(file)) = served.outcome.data else {
        panic!("the structured payload comes back as a file read");
    };
    assert_eq!(file.contents, body, "the lifted body is restored");
    assert_eq!(
        file.total_lines, 9,
        "and the fields that stayed inline are untouched"
    );
}

/// A lifted index against a variant with **no field to restore it into** is a hard error rather
/// than a silent drop, and it is raised while the index is *built* rather than when the entry is
/// served.
///
/// It means the record was written by a build that lifts a field this one does not know about, and
/// feeding the loop that payload with the field empty is exactly the quiet divergence the loud
/// errors exist to prevent. Catching it in [`ReplayInputs::new`] is what keeps that refusal
/// cheap: the alternative surfaces it halfway through a reconstruction that has already emitted
/// telemetry for a session it now cannot finish.
#[test]
fn a_lifted_payload_the_build_cannot_place_is_a_hard_error() {
    let mut builder = Builder::default();
    builder.clipped_read("root", 0, "body", 1_024);
    // Swap the variant out from under the lift, which is what a future build's record looks like
    // to this one.
    let GgReplayEntryKind::ToolResult { outcome, .. } = &mut builder.entries[0].kind else {
        panic!("a tool result");
    };
    outcome.data = Some(serde_json::to_value(ToolData::BytesWritten(42)).unwrap());
    let error = ReplayInputs::new(builder.build())
        .expect_err("the index refuses a payload it cannot restore")
        .to_string();
    assert!(
        error.contains("bytesWritten"),
        "the diagnostic names the variant it could not place, not the tagging envelope: {error}"
    );
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

/// A retired agent's outstanding **`git`** is the one thing it can still owe, so a waiter behind one
/// is *not* told the reconstruction is stuck.
///
/// This is not a nicety, it is what makes a concurrent board record reconstructable at all. gg's own
/// bookkeeping outlives the loop that dispatched it by a long way: an issue is dispatched, worked,
/// committed and **merged** under the root's name, and every one of those invocations is recorded
/// after the root's own `finish`. Treating the root's retirement as covering them would deadlock the
/// first issue agent that waited for the previous issue's merge — which is precisely the wait that
/// keeps the board block in every agent's pinned prompt the run's.
#[tokio::test]
async fn a_retired_agents_outstanding_git_is_waited_for_rather_than_deadlocked() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .git("root", 0, "git merge --no-ff --no-edit gg/issue-A-1")
            .model("agent-0", 1, "the next issue's first turn")
            .build(),
    )
    .expect("indexes")
    // Long enough that a release could only come from the merge landing, never from the ceiling.
    .with_stall_timeout(Duration::from_secs(600));
    // The root's *loop* is over; the merge it dispatched has not run yet.
    inputs.retire("root");

    assert!(
        tokio::time::timeout(Duration::from_millis(50), inputs.await_turn("agent-0"))
            .await
            .is_err(),
        "the merge can still happen, so the wait is real rather than provably stuck",
    );

    // The reconstruction's own (real) `git` catches up with the record's.
    inputs.next_git("root").expect("the recorded merge");
    inputs
        .await_turn("agent-0")
        .await
        .expect("released by the merge landing");
    assert!(inputs.stalls().is_empty(), "and not by the ceiling");
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
    // And the evidence survives the release. The abandoned entry is exactly what its name says —
    // an input the record pinned and this reconstruction never demanded — so it stays in the count
    // a playback reports. Dropping it here (which the first cut of the release did) meant the
    // barrier's own give-up erased the one remaining trace of itself.
    assert_eq!(
        inputs.unserved(),
        1,
        "the abandoned input is still an input nobody demanded",
    );
}

/// An abandoned entry that is *later* demanded after all leaves the count, rather than being
/// reported as undemanded forever.
///
/// The stall released the waiter early; it did not decide that the owner can never catch up. A
/// record whose owner asks a moment after the ceiling expired is a stall (the ordering was given
/// up on) but not an undemanded input, and the two figures have to be able to disagree.
#[tokio::test]
async fn a_stalled_entry_served_late_stops_counting_as_undemanded() {
    let inputs = impatient(
        Builder::default()
            .model("root", 0, "demanded late")
            .model("agent-0", 1, "waiting on it")
            .build(),
    );

    inputs
        .await_turn("agent-0")
        .await
        .expect("released by the ceiling");
    assert_eq!(inputs.stalls().len(), 1, "the give-up is recorded");
    assert_eq!(inputs.unserved(), 2, "with both entries still unserved");

    inputs.next_model("root").expect("the late call");
    assert_eq!(
        inputs.unserved(),
        1,
        "and the one that arrived is no longer undemanded",
    );
}

/// A `git` invocation recorded **inside** a running loop is provably stuck once its agent retires —
/// only the bookkeeping recorded *past* the loop's last act is exempt.
///
/// The exemption exists for one shape (an issue's commit and merge, recorded under the root long
/// after the root's own `finish`) and used to be granted to the whole `git` category, which meant no
/// wait behind any `git` could ever be a provable [`ReplayError::Deadlock`] — every one of them paid
/// the full stall ceiling to reach the same answer, and then, before stalls were reported, did so
/// silently.
#[tokio::test]
async fn a_git_recorded_inside_a_retired_agents_loop_is_a_provable_deadlock() {
    let inputs = ReplayInputs::new(
        Builder::default()
            // The root's loop demanded this `git` and then went on to another turn, so seq 0 is
            // squarely inside the loop rather than past its end.
            .git("root", 0, "git status --porcelain")
            .model("root", 1, "the root's own next turn")
            .model("agent-0", 2, "waiting behind the root's git")
            .build(),
    )
    .expect("indexes")
    .with_stall_timeout(Duration::from_secs(600));
    inputs.retire("root");

    let err = inputs
        .await_turn("agent-0")
        .await
        .expect_err("the root will never come back for a git its loop asked for");
    assert!(
        matches!(
            err,
            ReplayError::Deadlock {
                blocking_seq: 0,
                ..
            }
        ),
        "and it names the git that stopped it: {err:?}",
    );
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

/// A category a consumer does not serve does not gate anybody.
///
/// The failure this guards against is the one that would have been most confusing to debug: a
/// waiter blocks on **every** lower unserved seq, so a single entry in a category nobody consumes —
/// a playback reproduces neither the clock nor the cancel probe — would stall every agent behind it
/// for the whole reconstruction, half a minute at a time.
#[tokio::test]
async fn a_disregarded_category_stops_gating_the_barrier() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .git("root", 0, "git rev-parse HEAD")
            .clock("root", 1, 5_000)
            .probe("root", 2, false)
            .model("agent-0", 3, "behind all three")
            .build(),
    )
    .expect("indexes")
    // Long enough that a release could only come from the gate, never from the ceiling.
    .with_stall_timeout(Duration::from_secs(600));

    inputs.disregard(&[
        RecordedInputKind::Git,
        RecordedInputKind::Clock,
        RecordedInputKind::CancelProbe,
    ]);

    inputs.await_turn("agent-0").await.expect("not gated");
    assert!(inputs.stalls().is_empty(), "and not by stalling either");
    assert_eq!(
        inputs.unserved(),
        1,
        "and the disregarded entries stop counting as inputs the reconstruction failed to demand",
    );
}

/// The barrier can be turned **off**, which is what makes its value measurable rather than merely
/// argued for: the same record served both ways is the only honest comparison.
#[tokio::test]
async fn without_the_barrier_an_input_is_served_the_moment_it_is_asked_for() {
    let inputs = ReplayInputs::new(
        Builder::default()
            .model("root", 0, "never demanded")
            .model("agent-0", 1, "would wait for it")
            .build(),
    )
    .expect("indexes")
    // Long enough that a release could only come from the barrier being off.
    .with_stall_timeout(Duration::from_secs(600))
    .without_barrier();

    inputs.await_turn("agent-0").await.expect("not gated");
    assert_eq!(inputs.next_model("agent-0").expect("its call").seq, 1);
    assert!(
        inputs.stalls().is_empty(),
        "released by the gate, not a ceiling"
    );
}

// ---------------------------------------------------------------------------
// The recorded-command lookup ladder
// ---------------------------------------------------------------------------

/// Rung 1: the head of the agent's own queue, matched on the pair (command, directory).
#[test]
fn the_ladder_takes_the_head_when_it_matches() {
    let inputs = impatient(
        Builder::default()
            .shell("root", 0, "npm run build")
            .shell("root", 1, "npm test")
            .build(),
    );

    let found = inputs.take_shell("root", "npm run build", &GgShellCwd::Workspace);
    assert!(
        matches!(&found, ShellLookup::Head(run) if run.seq == 0),
        "{found:?}",
    );
    assert_eq!(inputs.unserved(), 1, "and only the head was consumed");
}

/// Rung 2: a match later in the same agent's queue answers, and everything stepped over is
/// **consumed** — so it can neither answer an unrelated later command nor keep gating the barrier.
#[test]
fn the_ladder_steps_over_a_command_the_build_no_longer_runs() {
    let inputs = impatient(
        Builder::default()
            .shell("root", 0, "git status")
            .shell("root", 1, "npm run build")
            .build(),
    );

    let found = inputs.take_shell("root", "npm run build", &GgShellCwd::Workspace);
    match found {
        ShellLookup::OutOfOrder { found, skipped } => {
            assert_eq!(found.seq, 1);
            assert_eq!(skipped.len(), 1);
            assert_eq!(skipped[0].command, "git status");
        }
        other => panic!("expected an out-of-order hit, got {other:?}"),
    }
    assert_eq!(
        inputs.unserved(),
        0,
        "both were consumed, not just the match"
    );
    assert!(
        matches!(
            inputs.take_shell("root", "git status", &GgShellCwd::Workspace),
            ShellLookup::Miss { .. },
        ),
        "a stepped-over command must not still be there to answer something else",
    );
}

/// Rung 3: another agent's queue is the safety net for an imperfect binding — and only the matched
/// entry is taken, because the other agent has not finished and its earlier commands are still its
/// own to ask for.
#[test]
fn the_ladder_crosses_to_another_agent_and_takes_only_the_match() {
    let inputs = impatient(
        Builder::default()
            .shell("agent-0", 0, "npm ci")
            .shell("agent-0", 1, "npm run build")
            .build(),
    );

    let found = inputs.take_shell("root", "npm run build", &GgShellCwd::Workspace);
    match found {
        ShellLookup::CrossAgent { found, agent_id } => {
            assert_eq!(found.seq, 1);
            assert_eq!(agent_id, "agent-0");
        }
        other => panic!("expected a cross-agent hit, got {other:?}"),
    }
    assert!(
        matches!(
            inputs.take_shell("agent-0", "npm ci", &GgShellCwd::Workspace),
            ShellLookup::Head(_),
        ),
        "the owning agent's earlier command is untouched",
    );
}

/// The same command in a different directory is a **different command**: it is not matched at any
/// rung, and the miss carries the head so a report can say what gg ran there instead.
#[test]
fn the_ladder_does_not_match_the_same_command_in_another_directory() {
    let inputs = impatient(Builder::default().shell("root", 0, "npm run build").build());

    let found = inputs.take_shell(
        "root",
        "npm run build",
        &GgShellCwd::Relative {
            path: "web".to_string(),
        },
    );
    match found {
        ShellLookup::Miss { head } => {
            assert_eq!(head.expect("the head comes back").command, "npm run build");
        }
        other => panic!("expected a miss, got {other:?}"),
    }
    assert_eq!(inputs.unserved(), 1, "and a miss consumes nothing");
}
