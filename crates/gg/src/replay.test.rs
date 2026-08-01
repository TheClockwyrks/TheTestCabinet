//! Tests for [replay capture](super): the streaming journal, the pooling that makes it cheap, and
//! the two properties the whole scheme rests on — capture stops **atomically**, and the journal
//! always says whether it is complete.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::GgCapabilitySet;
use test_cabinet_core::gg_replay::{
    GG_REPLAY_BLOB_REF_KEY, GG_REPLAY_FORMAT_VERSION, GgReplayPools,
};
use test_cabinet_core::gg_replay_journal::GG_REPLAY_JOURNAL_PATH;
use test_cabinet_core::metrics::TokenCounts;

use super::*;
use crate::context::{ContextModel, FileRegion, HeuristicTokenEstimator, UsageSignalOptions};
use crate::model::{FinishReason, ImageContent, Message, ModelResponse, Role, ToolCall};

/// A trivial [`ModelClient`] that returns a fixed response and records how many times it was
/// called — enough to prove the [`RecordingClient`] decorator delegates and records without
/// touching the network.
struct StubClient {
    model_id: String,
    response: ModelResponse,
    calls: AtomicUsize,
}

impl StubClient {
    fn new(model_id: &str, response: ModelResponse) -> Self {
        Self {
            model_id: model_id.to_string(),
            response,
            calls: AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for StubClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(self.response.clone())
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }
}

fn stop_response(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
    }
}

fn capability_set() -> GgCapabilitySet {
    serde_json::from_value(json!({})).expect("an empty capability set deserializes")
}

/// A recorder writing into a fresh temporary workspace, returning both so the journal can be read
/// back after [`finish`](GgRecorder::finish).
fn recorder_in(max_bytes: Option<u64>) -> (TempDir, GgRecorder) {
    recorder_at(GgReplayFidelity::Standard, max_bytes)
}

/// The same, at an explicit [fidelity](GgReplayFidelity) — the axis the `replay` capability now
/// selects, in place of the gate that used to decide whether any of this happened at all.
fn recorder_at(fidelity: GgReplayFidelity, max_bytes: Option<u64>) -> (TempDir, GgRecorder) {
    let dir = TempDir::new().expect("a temporary workspace");
    let recorder = GgRecorder::start(
        &dir.path().join(GG_REPLAY_JOURNAL_PATH),
        "run_1",
        &capability_set(),
        fidelity,
        max_bytes,
    )
    .expect("the journal opens");
    (dir, recorder)
}

/// Every line of the written journal, parsed.
fn journal(dir: &TempDir) -> Vec<GgJournalLine> {
    let text = std::fs::read_to_string(dir.path().join(GG_REPLAY_JOURNAL_PATH))
        .expect("the journal was written");
    text.lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|err| panic!("`{line}`: {err}")))
        .collect()
}

fn entries(lines: &[GgJournalLine]) -> Vec<&GgReplayEntry> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Entry { entry } => Some(entry.as_ref()),
            _ => None,
        })
        .collect()
}

fn end(lines: &[GgJournalLine]) -> Option<(u64, Option<GgReplayTruncation>)> {
    lines.iter().find_map(|line| match line {
        GgJournalLine::End {
            entries,
            truncation,
        } => Some((*entries, truncation.clone())),
        _ => None,
    })
}

/// The pool index each pool line claims, in write order, keyed by pool name.
fn pool_indices(lines: &[GgJournalLine], pool: &str) -> Vec<u32> {
    lines
        .iter()
        .filter_map(|line| match (pool, line) {
            ("message", GgJournalLine::Message { index, .. })
            | ("toolset", GgJournalLine::Toolset { index, .. })
            | ("text", GgJournalLine::Text { index, .. })
            | ("blob", GgJournalLine::Blob { index, .. }) => Some(*index),
            _ => None,
        })
        .collect()
}

fn tool_call(id: &str, name: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        name: name.to_string(),
        arguments: json!({ "path": "a.txt" }),
    }
}

// --- the journal ------------------------------------------------------------

#[test]
fn the_journal_opens_with_a_header_naming_the_session_and_the_build() {
    let (dir, recorder) = recorder_in(None);
    recorder.finish();

    let lines = journal(&dir);
    let GgJournalLine::Header {
        format_version,
        session_id,
        recorder: identity,
        ..
    } = &lines[0]
    else {
        panic!("the first line is the header, got {:?}", lines[0]);
    };
    assert_eq!(*format_version, GG_REPLAY_FORMAT_VERSION);
    assert_eq!(session_id, "run_1");
    assert_eq!(
        identity.gg_version.as_deref(),
        Some(env!("CARGO_PKG_VERSION")),
        "the record says which build wrote it — explanatory, never the compatibility gate"
    );
}

/// The header states the [fidelity](GgReplayFidelity) the run is being captured at, and the
/// recorder answers with the same one for the life of the run.
///
/// Both halves matter. The header is what tells a reader whether an absent full-only input means
/// "the session had none" or "this run was not recorded that closely"; the accessor is what the
/// full-only seams ask before spending bytes, and it is deliberately not a second read of the
/// capability set, which could disagree with what the journal already published.
#[test]
fn the_header_states_the_fidelity_the_run_is_captured_at() {
    for fidelity in [GgReplayFidelity::Standard, GgReplayFidelity::Full] {
        let (dir, recorder) = recorder_at(fidelity, None);
        assert_eq!(recorder.fidelity(), fidelity);
        recorder.finish();

        let lines = journal(&dir);
        let GgJournalLine::Header {
            fidelity: written, ..
        } = &lines[0]
        else {
            panic!("the first line is the header, got {:?}", lines[0]);
        };
        assert_eq!(*written, fidelity);
    }
}

/// The property assembly rests on: a complete capture terminates with an `End` line, so its
/// *absence* — and nothing the record claims about itself — is what marks a session that died
/// mid-capture.
#[test]
fn a_completed_capture_terminates_with_a_mandatory_end_line() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[Message::user("hi")],
        &[],
        &stop_response("done"),
    );
    let report = recorder.finish();

    let lines = journal(&dir);
    assert!(
        matches!(lines.last(), Some(GgJournalLine::End { .. })),
        "the End line is last, got {:?}",
        lines.last()
    );
    assert_eq!(end(&lines), Some((1, None)));
    assert_eq!(report.entries, 1);
    assert_eq!(report.truncation, None);
    assert_eq!(report.write_error, None);
}

#[test]
fn finishing_twice_writes_one_end_line() {
    let (dir, recorder) = recorder_in(None);
    let first = recorder.finish();
    let second = recorder.finish();

    assert_eq!(first.entries, second.entries);
    let ends = journal(&dir)
        .iter()
        .filter(|line| matches!(line, GgJournalLine::End { .. }))
        .count();
    assert_eq!(ends, 1);
}

#[test]
fn entries_are_stamped_by_agent_at_a_globally_monotonic_sequence() {
    let (dir, recorder) = recorder_in(None);
    let response = stop_response("done");
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[Message::user("hi")],
        &[],
        &response,
    );
    recorder.record_tool_result(
        "root",
        &tool_call("c1", "write_file"),
        &ToolOutcome::ok("wrote a.txt", "wrote a.txt"),
    );
    recorder.record_model_io(
        "agent-0",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[Message::user("go")],
        &[],
        &response,
    );
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    // One counter across both agents, so sorting on it recovers the true interleaving.
    assert_eq!(
        entries.iter().map(|entry| entry.seq).collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_eq!(
        entries
            .iter()
            .map(|entry| entry.agent_id.as_str())
            .collect::<Vec<_>>(),
        vec!["root", "root", "agent-0"]
    );
    assert!(matches!(entries[0].kind, GgReplayEntryKind::ModelIo { .. }));
    assert!(matches!(
        entries[1].kind,
        GgReplayEntryKind::ToolResult { .. }
    ));
}

// --- pooling ----------------------------------------------------------------

/// The size win, and the reason capture can be streamed at all: a conversation that grows by one
/// message a turn writes **one** new message body a turn, and the offered toolset is written once
/// for the whole run rather than once per turn.
#[test]
fn a_growing_conversation_writes_one_new_body_per_turn() {
    let (dir, recorder) = recorder_in(None);
    let tools = vec![ToolDefinition::new(
        "write_file",
        "write a file",
        json!({ "type": "object" }),
    )];
    let mut conversation = vec![Message::system("you are gg"), Message::user("build it")];
    for turn in 0..4 {
        recorder.record_model_io(
            "root",
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            &conversation,
            &tools,
            &stop_response("ok"),
        );
        conversation.push(Message::user(format!("turn {turn}")));
    }
    recorder.finish();

    let lines = journal(&dir);
    assert_eq!(
        pool_indices(&lines, "message"),
        vec![0, 1, 2, 3, 4],
        "two seed messages plus one new one per turn after the first"
    );
    assert_eq!(
        pool_indices(&lines, "toolset"),
        vec![0],
        "the offered toolset is written once, not once per turn"
    );
    // And every turn references the pooled bodies rather than restating them.
    let entries = entries(&lines);
    let GgReplayEntryKind::ModelIo { request, .. } = &entries[3].kind else {
        panic!("expected a model-io entry");
    };
    assert_eq!(request.messages, vec![0, 1, 2, 3, 4]);
    assert_eq!(request.toolset, Some(0));
}

#[test]
fn an_image_is_written_once_however_many_turns_it_survives() {
    let (dir, recorder) = recorder_in(None);
    let mut message = Message::user("look at this");
    message
        .images
        .push(ImageContent::new("image/png", "QUJD", 3));
    for _ in 0..3 {
        recorder.record_model_io(
            "root",
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            std::slice::from_ref(&message),
            &[],
            &stop_response("ok"),
        );
    }
    recorder.finish();

    let lines = journal(&dir);
    assert_eq!(pool_indices(&lines, "blob"), vec![0]);
    let stored = lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Message { message, .. } => Some(message),
            _ => None,
        })
        .expect("a message line");
    assert_eq!(
        stored.body["images"][0][GG_REPLAY_BLOB_REF_KEY],
        json!(0),
        "the stored body references the blob pool rather than carrying the payload again"
    );
}

/// A tool's output is quoted verbatim into the `tool` message that carries it into the window, so
/// the outcome and that message body are duplicates. One text pool collapses the pair.
#[test]
fn a_tool_outcome_interns_its_payloads_into_the_text_pool() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_tool_result(
        "root",
        &tool_call("c1", "shell"),
        &ToolOutcome::ok("a.txt\nb.txt", "listed 2 entries"),
    );
    recorder.record_tool_result(
        "root",
        &tool_call("c2", "shell"),
        &ToolOutcome::ok("a.txt\nb.txt", "listed 2 entries"),
    );
    recorder.finish();

    let lines = journal(&dir);
    assert_eq!(
        pool_indices(&lines, "text"),
        vec![0, 1],
        "the identical second outcome writes no new text"
    );
    let entries = entries(&lines);
    for entry in &entries {
        let GgReplayEntryKind::ToolResult { outcome, .. } = &entry.kind else {
            panic!("expected a tool-result entry");
        };
        assert_eq!(outcome.output, 0);
        assert_eq!(outcome.summary, Some(1));
        assert!(outcome.ok);
    }
}

/// The staleness detector is only worth anything if both ends compute it the same way. Both go
/// through `GgReplayInterner::intern_request`, so the recorder's fingerprint is by construction the
/// one a playback recomputes from the live request.
#[test]
fn the_recorded_fingerprint_is_the_one_the_shared_interner_folds() {
    let (dir, recorder) = recorder_in(None);
    let conversation = vec![Message::system("you are gg"), Message::user("build it")];
    let tools = vec![ToolDefinition::new(
        "write_file",
        "write a file",
        json!({ "type": "object" }),
    )];
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &conversation,
        &tools,
        &stop_response("ok"),
    );
    recorder.finish();

    let bodies: Vec<Value> = conversation
        .iter()
        .map(|message| serde_json::to_value(message).expect("serializes"))
        .collect();
    let offered = serde_json::to_value(&tools).expect("serializes");
    let expected = GgReplayPools::new().intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &bodies,
        Some(&offered),
    );

    let lines = journal(&dir);
    let GgReplayEntryKind::ModelIo { request, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    assert_eq!(request, &expected);
    assert_eq!(request.fingerprint.messages, 2);
    assert!(request.fingerprint.system.is_some());
    assert!(request.fingerprint.tools.is_some());
}

#[test]
fn a_turn_that_offered_no_tools_records_no_toolset_at_all() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[Message::user("hi")],
        &[],
        &stop_response("ok"),
    );
    recorder.finish();

    let lines = journal(&dir);
    let GgReplayEntryKind::ModelIo { request, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    // Absent, not an empty array: "offered nothing" and "offered an empty toolset" are different
    // facts, and only one of them is what a bare `complete(messages, &[])` means.
    assert_eq!(request.toolset, None);
    assert_eq!(request.fingerprint.tools, None);
    assert!(pool_indices(&lines, "toolset").is_empty());
}

// --- the prompt frame -------------------------------------------------------

/// A window holding one of each thing the frame has to distinguish: the system prompt, a build
/// prompt, a **paged** file view pushed on a numbered turn, and the rebuilt usage signal.
fn framed_window() -> ContextModel {
    let mut ctx = ContextModel::new(Arc::new(HeuristicTokenEstimator), Some(10_000), false);
    ctx.set_system("you are gg");
    ctx.push_user_prompt("build it");
    ctx.begin_turn(2);
    ctx.push_file_view(
        Some("src/main.rs".to_string()),
        Some(FileRegion {
            offset: 40,
            limit: 25,
        }),
        "c1",
        "fn main() {}",
        Vec::new(),
    );
    ctx.refresh_context_usage_signal(UsageSignalOptions {
        can_evict: true,
        can_archive: true,
        top_file_views: 5,
    });
    ctx
}

/// The four typed fields the frame exists for reach the journal: each item's slot, its retention,
/// the turn it was pushed on, and a paged view's region — none of which the flat message array the
/// client sent carries.
#[test]
fn a_prompt_frame_records_the_window_model_fields_the_request_cannot_carry() {
    let (dir, recorder) = recorder_in(None);
    let ctx = framed_window();
    let items: Vec<PromptItem<'_>> = ctx.prompt_items().collect();
    recorder.record_prompt_frame("root", &items);
    recorder.finish();

    let lines = journal(&dir);
    let GgReplayEntryKind::PromptFrame { items } = &entries(&lines)[0].kind else {
        panic!("expected a prompt-frame entry");
    };
    assert_eq!(items.len(), 4);
    assert_eq!(
        items.iter().map(|item| item.slot).collect::<Vec<_>>(),
        vec![
            GgReplayPromptSlot::System,
            GgReplayPromptSlot::Thread,
            GgReplayPromptSlot::Thread,
            GgReplayPromptSlot::ContextUsage,
        ]
    );
    assert_eq!(
        items.iter().map(|item| item.retention).collect::<Vec<_>>(),
        vec![
            GgReplayRetention::Pinned,
            GgReplayRetention::Pinned,
            GgReplayRetention::Ephemeral,
            GgReplayRetention::Pinned,
        ]
    );
    assert_eq!(
        items.iter().map(|item| item.turn).collect::<Vec<_>>(),
        vec![0, 0, 2, 2]
    );
    assert_eq!(
        items[2].label.as_deref(),
        Some("src/main.rs"),
        "the file view keeps the selector tag its band is attributed through"
    );
    assert_eq!(
        items[2].region,
        Some(GgReplayFileRegion {
            offset: 40,
            limit: 25
        }),
        "a paged read records the window it covers, not the whole file"
    );
    assert!(
        items
            .iter()
            .enumerate()
            .all(|(position, item)| (position == 2) == item.region.is_some()),
        "only the paged view carries a region"
    );
    // The items index the message pool in send order, so the frame reconstructs the window
    // rather than merely describing it.
    assert_eq!(
        items.iter().map(|item| item.message).collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );
}

/// Why the frame is nearly free: every message in it was interned moments earlier for the same
/// turn's model I/O, so the frame writes **no** new message bodies and is a list of small integers
/// pointing at the ones already on disk.
#[test]
fn a_prompt_frame_reuses_the_bodies_its_turns_model_io_already_pooled() {
    let (dir, recorder) = recorder_in(None);
    let ctx = framed_window();
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &ctx.messages(),
        &[],
        &stop_response("ok"),
    );
    let items: Vec<PromptItem<'_>> = ctx.prompt_items().collect();
    recorder.record_prompt_frame("root", &items);
    recorder.finish();

    let lines = journal(&dir);
    assert_eq!(
        pool_indices(&lines, "message"),
        vec![0, 1, 2, 3],
        "the frame writes no message body the model-io entry had not already written"
    );
    let entries = entries(&lines);
    let GgReplayEntryKind::ModelIo { request, .. } = &entries[0].kind else {
        panic!("expected a model-io entry");
    };
    let GgReplayEntryKind::PromptFrame { items } = &entries[1].kind else {
        panic!("expected a prompt-frame entry");
    };
    // Identical indices, because both seams intern through the one `GgReplayInterner` — which is
    // what lets a reconstruction line the frame's items up with the request's messages at all.
    assert_eq!(
        items.iter().map(|item| item.message).collect::<Vec<_>>(),
        request.messages
    );
}

/// The frame lands **after** the model call it describes and before that agent's next one — the
/// attachment rule tool results already follow, and the one that makes a vision-recovery retry
/// (`model_error → model_io → prompt_frame`) attach the frame to the call that was actually sent.
#[test]
fn a_prompt_frame_follows_the_turn_it_describes_at_the_next_sequence() {
    let (dir, recorder) = recorder_in(None);
    let ctx = framed_window();
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &ctx.messages(),
        &[],
        &stop_response("ok"),
    );
    let items: Vec<PromptItem<'_>> = ctx.prompt_items().collect();
    recorder.record_prompt_frame("agent_2", &items);
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    assert!(matches!(entries[0].kind, GgReplayEntryKind::ModelIo { .. }));
    assert!(matches!(
        entries[1].kind,
        GgReplayEntryKind::PromptFrame { .. }
    ));
    assert_eq!(entries[1].seq, entries[0].seq + 1);
    assert_eq!(
        entries[1].agent_id, "agent_2",
        "the frame is stamped with the agent whose window it is, like every other entry"
    );
}

/// Capture stops for the whole run, and that includes this seam: a frame recorded after a stop
/// writes nothing, so the pools on disk stay a contiguous prefix.
#[test]
fn a_stopped_capture_records_no_prompt_frame() {
    let (dir, recorder) = recorder_in(Some(1));
    let ctx = framed_window();
    let items: Vec<PromptItem<'_>> = ctx.prompt_items().collect();
    recorder.record_prompt_frame("root", &items);
    let report = recorder.finish();

    assert_eq!(report.entries, 0);
    let lines = journal(&dir);
    assert!(entries(&lines).is_empty());
    assert!(pool_indices(&lines, "message").is_empty());
}

// --- capture stops atomically -----------------------------------------------

/// The core of R12. A ceiling reached mid-run must not drop *individual* lines: a hole in a pool
/// shifts every later reference, silently substituting the wrong message body into a reconstructed
/// prompt. So capture stops for the whole run, the pools stay a contiguous prefix, and no entry
/// references a body that was never written.
#[test]
fn crossing_the_byte_ceiling_stops_capture_for_the_whole_run() {
    // Big enough for the header and a turn or two, far too small for twenty.
    let (dir, recorder) = recorder_in(Some(2_048));
    for turn in 0..20 {
        recorder.record_model_io(
            "root",
            GgClientRole::Agent,
            GgReplayRequestShape::Complete,
            &[Message::user(format!("turn {turn} {}", "x".repeat(200)))],
            &[],
            &stop_response("ok"),
        );
    }
    let report = recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    assert!(
        !entries.is_empty() && entries.len() < 20,
        "capture stopped part way, got {} entries",
        entries.len()
    );

    // Every pool is a contiguous prefix …
    let messages = pool_indices(&lines, "message");
    assert_eq!(
        messages,
        (0..messages.len() as u32).collect::<Vec<_>>(),
        "a pool index that skips is the hole this design exists to prevent"
    );
    // … and no entry references past its end.
    for entry in &entries {
        let GgReplayEntryKind::ModelIo { request, .. } = &entry.kind else {
            panic!("expected a model-io entry");
        };
        for index in &request.messages {
            assert!(
                (*index as usize) < messages.len(),
                "entry seq {} references message {index}, past the {} written",
                entry.seq,
                messages.len()
            );
        }
    }
    // The stop is permanent: entries are the journal's *first* n, with no later one sneaking in
    // after a smaller turn happened to fit.
    assert_eq!(
        entries.iter().map(|entry| entry.seq).collect::<Vec<_>>(),
        (0..entries.len() as u64).collect::<Vec<_>>()
    );

    let truncation = report.truncation.expect("the record is marked truncated");
    assert_eq!(truncation.reason, GgReplayTruncationReason::ByteCeiling);
    assert_eq!(truncation.last_seq, entries.last().map(|entry| entry.seq));
    assert_eq!(end(&lines), Some((entries.len() as u64, Some(truncation))));
}

/// The ceiling is exact rather than approximate: the batch that would cross it is not written at
/// all, because writing *part* of a batch is the hole.
#[test]
fn the_ceiling_is_never_exceeded_by_the_written_journal() {
    let ceiling = 4_096;
    let (dir, recorder) = recorder_in(Some(ceiling));
    for turn in 0..50 {
        recorder.record_tool_result(
            "root",
            &tool_call(&format!("c{turn}"), "shell"),
            &ToolOutcome::ok(format!("output {turn} {}", "y".repeat(100)), "ran"),
        );
    }
    recorder.finish();

    let written = std::fs::metadata(dir.path().join(GG_REPLAY_JOURNAL_PATH))
        .expect("the journal exists")
        .len();
    let end_line = journal(&dir)
        .iter()
        .filter(|line| matches!(line, GgJournalLine::End { .. }))
        .map(|line| serde_json::to_string(line).expect("serializes").len() as u64 + 1)
        .sum::<u64>();
    // The mandatory End line is deliberately exempt — a ceiling that suppressed the marker would
    // turn a deliberate truncation into an indistinguishable one.
    assert!(
        written - end_line <= ceiling,
        "wrote {written} bytes against a {ceiling}-byte ceiling"
    );
}

#[test]
fn a_stopped_capture_records_nothing_further() {
    let (dir, recorder) = recorder_in(Some(1));
    // Even the header does not fit, so capture is stopped before the first entry.
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[Message::user("hi")],
        &[],
        &stop_response("ok"),
    );
    let report = recorder.finish();

    assert_eq!(report.entries, 0);
    assert_eq!(
        report.truncation.map(|truncation| truncation.reason),
        Some(GgReplayTruncationReason::ByteCeiling)
    );
    let lines = journal(&dir);
    assert!(entries(&lines).is_empty());
    // The End line still lands, so the record is truncated rather than indistinguishable from a
    // session that was killed.
    assert!(matches!(lines.last(), Some(GgJournalLine::End { .. })));
}

// --- the recording client ---------------------------------------------------

/// The [`RecordingClient`] delegates to the wrapped client (returning its response and model id)
/// and streams the turn's model I/O as a side effect — the model-I/O recording seam.
#[tokio::test]
async fn recording_client_delegates_and_records_each_turn() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let stub = StubClient::new("mock/echo", stop_response("hi"));
    let client = RecordingClient::new(Box::new(stub), Arc::clone(&recorder), "root");

    assert_eq!(client.model_id(), "mock/echo");
    let out = client
        .complete(&[Message::user("first")], &[])
        .await
        .unwrap();
    assert_eq!(out.text.as_deref(), Some("hi"));
    client
        .complete(&[Message::user("second")], &[])
        .await
        .unwrap();
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    assert_eq!(entries.len(), 2, "each complete records one model-io entry");
    assert!(entries.iter().all(|entry| entry.agent_id == "root"));
    // The captured request is the exact conversation the turn was called with.
    let GgReplayEntryKind::ModelIo { request, .. } = &entries[0].kind else {
        panic!("expected a model-io entry");
    };
    let stored = lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Message { index, message } if *index == request.messages[0] => {
                Some(message)
            }
            _ => None,
        })
        .expect("the pooled body");
    assert_eq!(stored.body["content"], json!("first"));
    assert_eq!(request.shape, GgReplayRequestShape::Complete);
}

/// A required tool call must not be silently replayed as an offered one, so the call shape is part
/// of the record.
#[tokio::test]
async fn a_required_tool_call_records_its_shape() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let stub = StubClient::new("mock/echo", stop_response("hi"));
    let client = RecordingClient::new(Box::new(stub), Arc::clone(&recorder), "root");
    let tool = ToolDefinition::new("finish", "finish the run", json!({ "type": "object" }));

    client
        .complete_requiring(&[Message::user("wrap up")], &tool)
        .await
        .unwrap();
    recorder.finish();

    let lines = journal(&dir);
    let GgReplayEntryKind::ModelIo { request, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    assert_eq!(request.shape, GgReplayRequestShape::CompleteRequiring);
    assert_eq!(request.toolset, Some(0));
}

/// A recorded body is the message as the client sent it, so it round-trips back to the gg type a
/// reconstruction feeds the loop.
#[test]
fn a_pooled_body_round_trips_back_to_the_message_that_was_sent() {
    let (dir, recorder) = recorder_in(None);
    let sent = Message::user("build it");
    recorder.record_model_io(
        "root",
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        std::slice::from_ref(&sent),
        &[],
        &stop_response("ok"),
    );
    recorder.finish();

    let lines = journal(&dir);
    let stored = lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Message { message, .. } => Some(message),
            _ => None,
        })
        .expect("a message line");
    let back: Message = serde_json::from_value(stored.body.clone()).expect("deserializes");
    assert_eq!(back, sent);
    assert_eq!(back.role, Role::User);
}
