//! Tests for [session capture](super): the streaming journal, the pooling that makes it cheap, and
//! the two properties the whole scheme rests on — capture stops **atomically**, and the journal
//! always says whether it is complete.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{GgAgentStatus, GgCapabilitySet, GgContextSource};
use test_cabinet_core::gg_session_journal::GG_SESSION_JOURNAL_PATH;
use test_cabinet_core::gg_session_record::{
    GG_SESSION_FORMAT_VERSION, GG_SESSION_STREAM_MAX_BYTES, GG_SESSION_TOOL_MAX_BYTES,
    GgSessionAgentOrigin, GgSessionPools, fingerprint_exact,
};
use test_cabinet_core::metrics::TokenCounts;

use super::*;
use crate::context::{ContextModel, FileRegion, HeuristicTokenEstimator, UsageSignalOptions};
use crate::model::{
    FinishReason, ImageContent, LoopAborts, Message, ModelResponse, Role, ToolCall,
};

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
        provider: None,
        loop_aborts: LoopAborts::none(),
    }
}

/// The routing key the recorders below are started with.
const ROUTING_KEY: &str = "tz4a98xxat96iws9zmbrgj3a";

fn capability_set() -> GgCapabilitySet {
    serde_json::from_value(json!({})).expect("an empty capability set deserializes")
}

/// A recorder writing into a fresh temporary workspace, returning both so the journal can be read
/// back after [`finish`](GgRecorder::finish).
fn recorder_in(max_bytes: Option<u64>) -> (TempDir, GgRecorder) {
    let dir = TempDir::new().expect("a temporary workspace");
    let recorder = GgRecorder::start(
        &dir.path().join(GG_SESSION_JOURNAL_PATH),
        "run_1",
        ROUTING_KEY,
        &capability_set(),
        max_bytes,
    )
    .expect("the journal opens");
    (dir, recorder)
}

/// Every line of the written journal, parsed.
fn journal(dir: &TempDir) -> Vec<GgJournalLine> {
    let text = std::fs::read_to_string(dir.path().join(GG_SESSION_JOURNAL_PATH))
        .expect("the journal was written");
    text.lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|err| panic!("`{line}`: {err}")))
        .collect()
}

fn entries(lines: &[GgJournalLine]) -> Vec<&GgSessionEntry> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Entry { entry } => Some(entry.as_ref()),
            _ => None,
        })
        .collect()
}

fn end(lines: &[GgJournalLine]) -> Option<(u64, Option<GgSessionTruncation>)> {
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
            | ("text", GgJournalLine::Text { index, .. }) => Some(*index),
            _ => None,
        })
        .collect()
}

/// The `content` of the pooled message at `index` — how a test reads what a frame's item actually
/// says rather than only which pool slot it points at.
fn message_body(lines: &[GgJournalLine], index: u32) -> String {
    lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Message {
                index: at, message, ..
            } if *at == index => Some(message.body.clone()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("no pooled message at index {index}"))
        .get("content")
        .and_then(|content| content.as_str())
        .unwrap_or_default()
        .to_string()
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
        routing_key,
        recorder: identity,
        ..
    } = &lines[0]
    else {
        panic!("the first line is the header, got {:?}", lines[0]);
    };
    assert_eq!(*format_version, GG_SESSION_FORMAT_VERSION);
    assert_eq!(session_id, "run_1");
    assert_eq!(
        routing_key.as_deref(),
        Some(ROUTING_KEY),
        "the header keeps the routing key beside the session id",
    );
    assert_eq!(
        identity.gg_version.as_deref(),
        Some(env!("CARGO_PKG_VERSION")),
        "the record says which build wrote it — explanatory, never the compatibility gate"
    );
}

/// The property assembly rests on: a complete capture terminates with an `End` line, so its
/// *absence* — and nothing the record claims about itself — is what marks a session that died
/// mid-capture.
#[test]
fn a_completed_capture_terminates_with_a_mandatory_end_line() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_model_io(
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &[Message::user("hi")],
            tools: &[],
            duration_ms: None,
        },
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

/// **A writer thread that died mid-run is reported as a write failure, not as a clean recording.**
///
/// The one capture failure with no I/O error behind it: the thread is simply gone, so nothing it was
/// carrying was written and nothing it was carrying was reported. A report of `None` here is not a
/// missing detail, it is a *wrong* one — it says the journal is whole, and assembly reads it that
/// way, so a record short by an unknown number of entries is served as the session. The panic is
/// gg's own defect and it is reported rather than latched, for the reason on
/// [`finish`](GgRecorder::finish): the journal is a debugging sidecar and the run around it is still
/// a run somebody can score.
#[test]
fn a_panicked_writer_is_reported_as_a_write_failure() {
    let (_dir, recorder) = recorder_in(None);
    recorder.record_model_io(
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &[Message::user(WRITER_PANIC_MARKER)],
            tools: &[],
            duration_ms: None,
        },
        &stop_response("done"),
    );

    let report = recorder.finish();

    let error = report
        .write_error
        .expect("a writer that died owes the operator an account of what is missing");
    assert!(
        error.contains("panicked") && error.contains("missing from the record"),
        "the report must say the journal is short and why, since nothing else can: {error}"
    );
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &[Message::user("hi")],
            tools: &[],
            duration_ms: None,
        },
        &response,
    );
    recorder.record_tool_result(
        "root",
        &tool_call("c1", "write_file"),
        &ToolOutcome::ok("wrote a.txt", "wrote a.txt"),
    );
    recorder.record_model_io(
        RecordedCall {
            agent_id: "agent-0",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &[Message::user("go")],
            tools: &[],
            duration_ms: None,
        },
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
    assert!(matches!(
        entries[0].kind,
        GgSessionEntryKind::ModelIo { .. }
    ));
    assert!(matches!(
        entries[1].kind,
        GgSessionEntryKind::ToolResult { .. }
    ));
}

// --- provenance: the invocation envelope and the agent table ----------------

/// The envelope as the launch hands it over, naming one model with a resolved window and the
/// given vision state.
fn recorded_seed<'a>(prompt: &'a str, vision: bool) -> RecordedSeed<'a> {
    RecordedSeed {
        prompt,
        baseline_commit: Some("abc123"),
        model_windows: BTreeMap::from([("mock/echo".to_string(), 128_000)]),
        model_providers: BTreeMap::from([("mock/echo".to_string(), "mock".to_string())]),
        model_modalities: BTreeMap::from([(
            "mock/echo".to_string(),
            GgSessionModalities { vision },
        )]),
    }
}

/// The [seed](GgJournalLine::Seed) lines the journal carries, in write order.
fn seeds(lines: &[GgJournalLine]) -> Vec<&GgSessionSeed> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Seed { seed } => Some(seed.as_ref()),
            _ => None,
        })
        .collect()
}

/// The [agent](GgJournalLine::Agent) rows the journal carries, in write order — **not** upserted,
/// which is assembly's job: this is what a recorder actually emitted.
fn agent_rows(lines: &[GgJournalLine]) -> Vec<&GgSessionAgent> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Agent { agent } => Some(agent.as_ref()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_seed_records_the_envelope_the_session_started_from() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_seed(recorded_seed("Build a tiny game.", true));
    recorder.finish();

    let lines = journal(&dir);
    let seeds = seeds(&lines);
    assert_eq!(seeds.len(), 1);
    assert_eq!(seeds[0].prompt, "Build a tiny game.");
    assert_eq!(seeds[0].baseline_commit.as_deref(), Some("abc123"));
    assert_eq!(seeds[0].model_windows["mock/echo"], 128_000);
    assert!(seeds[0].model_modalities["mock/echo"].vision);
}

/// The modality state is not a launch fact. A provider that refused an image denies that model for
/// the rest of the run, so the envelope is rewritten at teardown — and assembly keeps the last one.
#[test]
fn a_denial_rewrites_the_envelope_with_the_resolved_modalities() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_seed(recorded_seed("Build a tiny game.", true));
    recorder.record_resolved_modalities(BTreeMap::from([(
        "mock/echo".to_string(),
        GgSessionModalities { vision: false },
    )]));
    recorder.finish();

    let lines = journal(&dir);
    let seeds = seeds(&lines);
    assert_eq!(
        seeds.len(),
        2,
        "the resolved envelope supersedes the opening one"
    );
    assert!(seeds[0].model_modalities["mock/echo"].vision);
    assert!(!seeds[1].model_modalities["mock/echo"].vision);
    assert_eq!(
        seeds[1].prompt, "Build a tiny game.",
        "and the rest of the envelope is carried across unchanged",
    );
}

/// The overwhelmingly common run — nothing was ever denied — pays nothing for the resolved pass.
#[test]
fn an_unchanged_modality_state_writes_no_second_envelope() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_seed(recorded_seed("Build a tiny game.", true));
    recorder.record_resolved_modalities(BTreeMap::from([(
        "mock/echo".to_string(),
        GgSessionModalities { vision: true },
    )]));
    recorder.finish();

    assert_eq!(seeds(&journal(&dir)).len(), 1);
}

/// An agent is written into the table when it **comes into existence** and again when its loop
/// ends. Both rows, in that order, are what let assembly keep the terminal one while an agent that
/// never reached an ending still has the row it was born with.
#[test]
fn an_agent_is_recorded_when_it_is_born_and_again_when_it_ends() {
    let (dir, recorder) = recorder_in(None);
    let born = GgSessionAgent {
        agent_id: "agent-0".to_string(),
        profile_id: "worker".to_string(),
        profile: "The Worker".to_string(),
        origin: GgSessionAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
        terminal_status: None,
        limit_hit: None,
    };
    recorder.record_agent(born.clone());
    recorder.record_agent(GgSessionAgent {
        terminal_status: Some(GgAgentStatus::Done),
        ..born
    });
    recorder.finish();

    let lines = journal(&dir);
    let rows = agent_rows(&lines);
    assert_eq!(rows.len(), 2, "the opening row and the terminal one");
    assert_eq!(rows[0].terminal_status, None);
    assert_eq!(rows[1].terminal_status, Some(GgAgentStatus::Done));
    assert_eq!(
        rows[1].origin,
        GgSessionAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
        "and the terminal row repeats the keys the agent is bound by",
    );
    assert_eq!(
        rows[1].profile_id, "worker",
        "and the profile id that joins the row to the run's capability set",
    );
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
            RecordedCall {
                agent_id: "root",
                role: GgClientRole::Agent,
                shape: GgSessionRequestShape::Complete,
                messages: &conversation,
                tools: &tools,
                duration_ms: None,
            },
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
    let GgSessionEntryKind::ModelIo { request, .. } = &entries[3].kind else {
        panic!("expected a model-io entry");
    };
    assert_eq!(request.messages, vec![0, 1, 2, 3, 4]);
    assert_eq!(request.toolset, Some(0));
}

/// A picture the model was shown is recorded as its **descriptor** and never as its payload —
/// the same thing the telemetry stream records of the same turn.
#[test]
fn a_journalled_message_keeps_a_pictures_descriptor_and_not_its_bytes() {
    let (dir, recorder) = recorder_in(None);
    let mut message = Message::user("look at this");
    message
        .images
        .push(ImageContent::new("image/png", "QUJD", 3));
    for _ in 0..3 {
        recorder.record_model_io(
            RecordedCall {
                agent_id: "root",
                role: GgClientRole::Agent,
                shape: GgSessionRequestShape::Complete,
                messages: std::slice::from_ref(&message),
                tools: &[],
                duration_ms: None,
            },
            &stop_response("ok"),
        );
    }
    recorder.finish();

    let lines = journal(&dir);
    let stored = lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Message { message, .. } => Some(message),
            _ => None,
        })
        .expect("a message line");
    let image = &stored.body["images"][0];
    assert_eq!(image["mediaType"], json!("image/png"));
    assert_eq!(image["bytes"], json!(3));
    assert!(
        image.get("dataBase64").is_none(),
        "the stored body keeps the descriptor and never the payload: {image}"
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
        let GgSessionEntryKind::ToolResult { outcome, .. } = &entry.kind else {
            panic!("expected a tool-result entry");
        };
        assert_eq!(outcome.output, 0);
        assert_eq!(outcome.summary, Some(1));
        assert!(outcome.ok);
    }
}

/// The recorded request is whatever the shared interner folds a live one into — the recorder adds
/// no interning of its own, so a request in the record indexes the same pools as every other
/// reference to those bodies.
#[test]
fn the_recorded_request_is_the_one_the_shared_interner_folds() {
    let (dir, recorder) = recorder_in(None);
    let conversation = vec![Message::system("you are gg"), Message::user("build it")];
    let tools = vec![ToolDefinition::new(
        "write_file",
        "write a file",
        json!({ "type": "object" }),
    )];
    recorder.record_model_io(
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &conversation,
            tools: &tools,
            duration_ms: None,
        },
        &stop_response("ok"),
    );
    recorder.finish();

    let bodies: Vec<Value> = conversation
        .iter()
        .map(|message| serde_json::to_value(message).expect("serializes"))
        .collect();
    let offered = serde_json::to_value(&tools).expect("serializes");
    let expected = GgSessionPools::new().intern_request(
        GgClientRole::Agent,
        GgSessionRequestShape::Complete,
        &bodies,
        Some(&offered),
    );

    let lines = journal(&dir);
    let GgSessionEntryKind::ModelIo { request, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    assert_eq!(request, &expected);
    assert_eq!(request.messages.len(), 2);
    assert!(request.toolset.is_some());
}

#[test]
fn a_turn_that_offered_no_tools_records_no_toolset_at_all() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_model_io(
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &[Message::user("hi")],
            tools: &[],
            duration_ms: None,
        },
        &stop_response("ok"),
    );
    recorder.finish();

    let lines = journal(&dir);
    let GgSessionEntryKind::ModelIo { request, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    // Absent, not an empty array: "offered nothing" and "offered an empty toolset" are different
    // facts, and only one of them is what a bare `complete(messages, &[])` means.
    assert_eq!(request.toolset, None);
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
        program_language: None,
        can_close_views: false,
        can_archive: true,
        top_file_views: 5,
        threshold_percent: 0,
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
    let GgSessionEntryKind::PromptFrame { items } = &entries(&lines)[0].kind else {
        panic!("expected a prompt-frame entry");
    };
    assert_eq!(items.len(), 4);
    assert_eq!(
        items.iter().map(|item| item.slot).collect::<Vec<_>>(),
        vec![
            GgSessionPromptSlot::System,
            GgSessionPromptSlot::Thread,
            GgSessionPromptSlot::Thread,
            GgSessionPromptSlot::ContextUsage,
        ]
    );
    assert_eq!(
        items.iter().map(|item| item.retention).collect::<Vec<_>>(),
        vec![
            GgSessionRetention::Pinned,
            GgSessionRetention::Pinned,
            GgSessionRetention::Ephemeral,
            GgSessionRetention::Pinned,
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
        Some(GgSessionFileRegion {
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
    // The items index the message pool in send order, so the frame *is* the window rather than a
    // description of it: a reader follows each item into the body the model was sent.
    assert_eq!(
        items.iter().map(|item| item.message).collect::<Vec<_>>(),
        vec![0, 1, 2, 3]
    );
}

/// A **text view** round-trips through the frame with no contract change: `source: "text_view"`,
/// the label the agent gave it as the selector, and no region.
///
/// The frame was built to carry a file view's `(path, region)` key, and a text view fits it because
/// the three fields were never file-specific — the label *is* the selector for both bands. Pinned
/// here because it is the whole justification for adding no separate view contract to the record: a
/// reader that could not name which view a band's tokens belonged to could not attribute the
/// window it is looking at.
#[test]
fn a_prompt_frame_records_a_text_view_by_its_label_with_no_region() {
    let (dir, recorder) = recorder_in(None);
    let mut ctx = ContextModel::new(Arc::new(HeuristicTokenEstimator), Some(10_000), true);
    ctx.begin_turn(3);
    ctx.open_text_view(
        "changed-files".to_string(),
        "src/main.rs\nsrc/lib.rs".to_string(),
    );
    let items: Vec<PromptItem<'_>> = ctx.prompt_items().collect();
    recorder.record_prompt_frame("root", &items);
    recorder.finish();

    let lines = journal(&dir);
    let GgSessionEntryKind::PromptFrame { items } = &entries(&lines)[0].kind else {
        panic!("expected a prompt-frame entry");
    };
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].source, GgContextSource::TextView);
    assert_eq!(items[0].label.as_deref(), Some("changed-files"));
    assert_eq!(items[0].region, None, "a text view covers no file region");
    assert_eq!(items[0].retention, GgSessionRetention::Ephemeral);
    assert_eq!(items[0].turn, 3);

    // The band's wire tag is the one the console keys its palette and its attribution off.
    let raw = serde_json::to_value(items[0].source).unwrap();
    assert_eq!(raw, serde_json::json!("text_view"));

    // The body reaches the pool intact, heading and all, so the record holds what the model read.
    let body = message_body(&lines, items[0].message);
    assert_eq!(
        body, "View: changed-files\n----\nsrc/main.rs\nsrc/lib.rs",
        "the pooled body is the message the model was sent"
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &ctx.messages(),
            tools: &[],
            duration_ms: None,
        },
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
    let GgSessionEntryKind::ModelIo { request, .. } = &entries[0].kind else {
        panic!("expected a model-io entry");
    };
    let GgSessionEntryKind::PromptFrame { items } = &entries[1].kind else {
        panic!("expected a prompt-frame entry");
    };
    // Identical indices, because both seams intern through the one `GgSessionInterner` — which is
    // what lets a reader line the frame's items up with the request's messages at all.
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &ctx.messages(),
            tools: &[],
            duration_ms: None,
        },
        &stop_response("ok"),
    );
    let items: Vec<PromptItem<'_>> = ctx.prompt_items().collect();
    recorder.record_prompt_frame("agent_2", &items);
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    assert!(matches!(
        entries[0].kind,
        GgSessionEntryKind::ModelIo { .. }
    ));
    assert!(matches!(
        entries[1].kind,
        GgSessionEntryKind::PromptFrame { .. }
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
/// shifts every later reference, silently substituting the wrong message body into a recorded
/// prompt. So capture stops for the whole run, the pools stay a contiguous prefix, and no entry
/// references a body that was never written.
#[test]
fn crossing_the_byte_ceiling_stops_capture_for_the_whole_run() {
    // Big enough for the header and a turn or two, far too small for twenty. Measured against a
    // header the journal actually writes rather than guessed: the header carries the run's whole
    // capability set, so a figure chosen once stops leaving room for any turn at all the moment a
    // fully specified set grows.
    let (header, empty) = recorder_in(None);
    empty.finish();
    let header_bytes = std::fs::metadata(header.path().join(GG_SESSION_JOURNAL_PATH))
        .expect("the header was written")
        .len();
    let (dir, recorder) = recorder_in(Some(header_bytes + 2_048));
    for turn in 0..20 {
        recorder.record_model_io(
            RecordedCall {
                agent_id: "root",
                role: GgClientRole::Agent,
                shape: GgSessionRequestShape::Complete,
                messages: &[Message::user(format!("turn {turn} {}", "x".repeat(200)))],
                tools: &[],
                duration_ms: None,
            },
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
        let GgSessionEntryKind::ModelIo { request, .. } = &entry.kind else {
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
    assert_eq!(truncation.reason, GgSessionTruncationReason::ByteCeiling);
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

    let written = std::fs::metadata(dir.path().join(GG_SESSION_JOURNAL_PATH))
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: &[Message::user("hi")],
            tools: &[],
            duration_ms: None,
        },
        &stop_response("ok"),
    );
    let report = recorder.finish();

    assert_eq!(report.entries, 0);
    assert_eq!(
        report.truncation.map(|truncation| truncation.reason),
        Some(GgSessionTruncationReason::ByteCeiling)
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
    let GgSessionEntryKind::ModelIo { request, .. } = &entries[0].kind else {
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
    assert_eq!(request.shape, GgSessionRequestShape::Complete);
}

/// Every recorded call carries the provider's latency. The clock is read around the inner call and
/// nowhere else, so `duration_ms` is what the provider took rather than what the recorder did —
/// and it is recorded on every run, because "how long did this model take to answer" is one of the
/// four things a session is compared on.
#[tokio::test]
async fn a_recorded_call_carries_the_providers_latency() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let client = RecordingClient::new(
        Box::new(StubClient::new("mock/echo", stop_response("hi"))),
        Arc::clone(&recorder),
        "root",
    );

    client.complete(&[Message::user("go")], &[]).await.unwrap();
    recorder.finish();

    let lines = journal(&dir);
    let GgSessionEntryKind::ModelIo { duration_ms, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    assert!(
        duration_ms.is_some(),
        "a recorded call states how long it took"
    );
}

/// A required tool call and an offered one are different turns, so the call shape is part of the
/// record rather than something a reader has to infer from the response.
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
    let GgSessionEntryKind::ModelIo { request, .. } = &entries(&lines)[0].kind else {
        panic!("expected a model-io entry");
    };
    assert_eq!(request.shape, GgSessionRequestShape::CompleteRequiring);
    assert_eq!(request.toolset, Some(0));
}

/// A recorded body is the message as the client sent it, so it round-trips back to the gg type the
/// loop was handed.
#[test]
fn a_pooled_body_round_trips_back_to_the_message_that_was_sent() {
    let (dir, recorder) = recorder_in(None);
    let sent = Message::user("build it");
    recorder.record_model_io(
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgSessionRequestShape::Complete,
            messages: std::slice::from_ref(&sent),
            tools: &[],
            duration_ms: None,
        },
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

// --- model errors, the second client, and the latency clock -----------------

/// A [`ModelClient`] whose first call fails and whose later calls succeed — the shape of the two
/// recoverable failures (a vision refusal, a retry exhaustion counted against the error ceiling).
struct FailingOnceClient {
    error: Mutex<Option<ModelError>>,
    response: ModelResponse,
}

impl FailingOnceClient {
    fn new(error: ModelError, response: ModelResponse) -> Self {
        Self {
            error: Mutex::new(Some(error)),
            response,
        }
    }
}

#[async_trait::async_trait]
impl ModelClient for FailingOnceClient {
    async fn complete(
        &self,
        _messages: &[Message],
        _tools: &[ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        match self.error.lock().expect("the scripted error").take() {
            Some(error) => Err(error),
            None => Ok(self.response.clone()),
        }
    }

    fn model_id(&self) -> &str {
        "mock/echo"
    }
}

/// A failed model call is an **input**, and one this build records: a run that recovers from a
/// vision refusal would otherwise have nothing in its record at exactly the turn a developer
/// opened the record to look at.
///
/// This is the vision-recovery shape end to end: the refused call and the stripped retry both go
/// through the same wrapped client, so the record reads `model_error → model_io`, and the class
/// the loop branched on — not merely the message — is what the entry carries.
#[tokio::test]
async fn a_refused_turn_records_its_error_before_the_call_that_replaced_it() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let client = RecordingClient::new(
        Box::new(FailingOnceClient::new(
            ModelError::VisionUnsupported {
                model_id: "mock/echo".to_string(),
                message: "no image route".to_string(),
            },
            stop_response("done"),
        )),
        Arc::clone(&recorder),
        "root",
    );

    let refused = client.complete(&[Message::user("look")], &[]).await;
    assert!(refused.is_err(), "the first call is the refusal");
    // The loop's own recovery: strip the images and re-run the same turn.
    client
        .complete(&[Message::user("look (no images)")], &[])
        .await
        .expect("the stripped retry succeeds");
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    let GgSessionEntryKind::ModelError { error, request, .. } = &entries[0].kind else {
        panic!("the refusal is recorded first, got {:?}", entries[0].kind);
    };
    assert_eq!(error.kind, GgSessionModelErrorKind::VisionUnsupported);
    assert_eq!(error.model_id.as_deref(), Some("mock/echo"));
    assert_eq!(
        request.messages.len(),
        1,
        "the request identifies which turn failed"
    );
    assert!(
        matches!(entries[1].kind, GgSessionEntryKind::ModelIo { .. }),
        "the retry that was actually sent follows it, got {:?}",
        entries[1].kind
    );
    assert!(
        entries[0].seq < entries[1].seq,
        "and the ordering is what attaches the turn's prompt frame to the call that was sent"
    );
}

/// Every [`ModelError`] class the loop branches on survives into the record as a class, not as a
/// rendered sentence — a reader has to be able to tell that a call failed for a reason that strips
/// images and retries, not merely that it failed.
#[test]
fn every_model_error_class_is_recorded_as_the_class_the_loop_branched_on() {
    let cases = [
        (
            ModelError::MissingApiKey,
            GgSessionModelErrorKind::MissingApiKey,
        ),
        (
            ModelError::Fatal {
                status: 402,
                message: "no credit".to_string(),
            },
            GgSessionModelErrorKind::Fatal,
        ),
        (
            ModelError::RetryExhausted {
                attempts: 4,
                last: "504".to_string(),
            },
            GgSessionModelErrorKind::RetryExhausted,
        ),
        (
            ModelError::Parse("not json".to_string()),
            GgSessionModelErrorKind::Parse,
        ),
        (
            ModelError::ResponseLoop {
                discarded: LoopAborts {
                    attempts: 4,
                    words: 12_260,
                    chars: 77_800,
                },
                detail: "2 words repeated across 3000 consecutive words".to_string(),
            },
            GgSessionModelErrorKind::ResponseLoop,
        ),
    ];
    for (error, expected) in cases {
        let recorded = session_model_error(&error);
        assert_eq!(recorded.kind, expected);
        assert_eq!(recorded.message, error.to_string());
    }
    assert_eq!(
        session_model_error(&ModelError::Fatal {
            status: 402,
            message: "no credit".to_string(),
        })
        .status,
        Some(402),
        "the status a fatal error carried is what a reader diagnoses it from"
    );
    assert_eq!(
        session_model_error(&ModelError::RetryExhausted {
            attempts: 4,
            last: "504".to_string(),
        })
        .attempts,
        Some(4),
        "and the attempt count is what says how much of the run's clock the failure cost"
    );
    assert_eq!(
        session_model_error(&ModelError::ResponseLoop {
            discarded: LoopAborts {
                attempts: 3,
                words: 9_195,
                chars: 750_003,
            },
            detail: "the reply passed 250001 characters without finishing".to_string(),
        })
        .attempts,
        Some(3),
        "for a loop the attempt count is the only surviving trace of the discarded replies — the \
         replies themselves were never returned and so were never journalled"
    );
}

/// gg's **second** model client — the handoff-compaction summarizer — is recorded, on its own
/// queue.
///
/// It was never wrapped at all before this, so every handoff-compaction call in every record
/// captured to date is missing. The [role](GgClientRole) is what makes capturing it *safe*:
/// without the discriminator a summarizer call and the agent's own next turn interleave into one
/// indistinguishable queue and a reader cannot tell which of the two a recorded call was.
#[tokio::test]
async fn the_compaction_summarizers_calls_are_recorded_on_their_own_queue() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let agent = RecordingClient::new(
        Box::new(StubClient::new("mock/agent", stop_response("working"))),
        Arc::clone(&recorder),
        "root",
    );
    let summarizer = RecordingClient::for_compaction(
        Box::new(StubClient::new("mock/small", stop_response("a summary"))),
        Arc::clone(&recorder),
        "root",
    );

    agent.complete(&[Message::user("turn 1")], &[]).await.ok();
    summarizer
        .complete(&[Message::user("condense this")], &[])
        .await
        .ok();
    agent.complete(&[Message::user("turn 2")], &[]).await.ok();
    recorder.finish();

    let lines = journal(&dir);
    let roles: Vec<GgClientRole> = entries(&lines)
        .iter()
        .filter_map(|entry| match &entry.kind {
            GgSessionEntryKind::ModelIo { request, .. } => Some(request.role),
            _ => None,
        })
        .collect();
    assert_eq!(
        roles,
        vec![
            GgClientRole::Agent,
            GgClientRole::Compaction,
            GgClientRole::Agent
        ],
        "the summarizer's call is recorded, and is distinguishable from the agent's own turns"
    );
}

// --- subprocesses: shell, git, and the working directory --------------------

/// A hook's command runs `sh -c` but never reaches tool dispatch, so before this seam it was
/// recorded nowhere at all — and an agent-stop hook's decides whether the session may end. The
/// origin travels with the command so a record reads back which of gg's paths asked for it.
#[test]
fn a_recorded_command_carries_its_origin_streams_and_working_directory() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_shell(
        "root",
        GgShellOrigin::Hook,
        RecordedCommand {
            command: "npm test",
            cwd: GgShellCwd::Relative {
                path: "web".to_string(),
            },
            exit_code: 1,
            stdout: "3 passing",
            stderr: "1 failing",
        },
    );
    recorder.finish();

    let lines = journal(&dir);
    let GgSessionEntryKind::Shell { origin, command } = &entries(&lines)[0].kind else {
        panic!("expected a shell entry");
    };
    assert_eq!(*origin, GgShellOrigin::Hook);
    assert_eq!(command.command, "npm test");
    assert_eq!(command.exit_code, 1);
    assert_eq!(
        command.cwd,
        GgShellCwd::Relative {
            path: "web".to_string()
        }
    );
    // The two streams are interned separately, and into the text pool rather than inline.
    assert_eq!(pool_indices(&lines, "text"), vec![0, 1]);
    assert_ne!(command.stdout, command.stderr);
}

/// gg's own `git` bypasses tool dispatch entirely, so this seam is the only thing that records
/// it — without it a run that ended in a merge conflict would leave no trace of the conflict. Its
/// streams are pooled like every other bulky payload.
#[test]
fn a_recorded_git_invocation_interns_both_of_its_streams() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_git(
        "root",
        RecordedCommand {
            command: "git merge --no-ff gg/issue-1",
            cwd: GgShellCwd::Workspace,
            exit_code: 1,
            stdout: "CONFLICT (content): Merge conflict in src/main.rs",
            stderr: "",
        },
    );
    recorder.finish();

    let lines = journal(&dir);
    let GgSessionEntryKind::Git { command } = &entries(&lines)[0].kind else {
        panic!("expected a git entry");
    };
    assert_eq!(command.cwd, GgShellCwd::Workspace);
    let texts: Vec<&str> = lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        texts[command.stdout as usize],
        "CONFLICT (content): Merge conflict in src/main.rs"
    );
    assert_eq!(texts[command.stderr as usize], "");
}

/// One payload recorded from two different seams occupies **one** text-pool entry.
///
/// This is what the text pool is for: an issue's `git diff --stat` is recorded as a `git`
/// invocation's stdout *and* quoted into the brief its reviewer is dispatched with, and a tool's
/// output is recorded as an outcome *and* quoted into the `tool` message that carries it into the
/// window. Interning against one content-addressed table collapses each pair to a single copy.
#[test]
fn one_payload_recorded_from_two_seams_shares_one_text_pool_entry() {
    let (dir, recorder) = recorder_in(None);
    let patch = "diff --git a/src/main.rs b/src/main.rs\n+fn main() {}\n";
    recorder.record_git(
        "root",
        RecordedCommand {
            command: "git diff --cached HEAD",
            cwd: GgShellCwd::Workspace,
            exit_code: 0,
            stdout: patch,
            stderr: "",
        },
    );
    recorder.record_tool_result(
        "root",
        &tool_call("call_1", "read_file"),
        &ToolOutcome::ok(patch.to_string(), "read the patch".to_string()),
    );
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    let GgSessionEntryKind::Git { command } = &entries[0].kind else {
        panic!("expected a git entry");
    };
    let GgSessionEntryKind::ToolResult { outcome, .. } = &entries[1].kind else {
        panic!("expected a tool result");
    };
    assert_eq!(
        command.stdout, outcome.output,
        "the same payload interns to the same index whichever seam recorded it"
    );
    let bodies: Vec<&str> = lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Text { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        bodies.iter().filter(|text| **text == patch).count(),
        1,
        "and it is written to the journal exactly once"
    );
}

// --- payload clipping, the standard/full difference -------------------------

/// A payload past the standard ceiling is **clipped**, and the record says so.
///
/// The clip has to be self-describing: a reader handed 32 KiB cannot otherwise tell a command that
/// printed exactly that much from one that printed megabytes, and it is the second case where the
/// missing part is the part worth having.
#[test]
fn a_standard_capture_clips_a_large_payload_and_records_what_it_dropped() {
    let (dir, recorder) = recorder_in(None);
    let huge = "x".repeat(GG_SESSION_STREAM_MAX_BYTES * 2);
    recorder.record_git(
        "root",
        RecordedCommand {
            command: "git diff --cached HEAD",
            cwd: GgShellCwd::Workspace,
            exit_code: 0,
            stdout: &huge,
            stderr: "",
        },
    );
    recorder.finish();

    let lines = journal(&dir);
    let (text, clip) = lines
        .iter()
        .find_map(|line| match line {
            GgJournalLine::Text { text, clip, .. } if !text.is_empty() => {
                Some((text.clone(), clip.clone()))
            }
            _ => None,
        })
        .expect("the stdout line");
    assert_eq!(text.len(), GG_SESSION_STREAM_MAX_BYTES);
    let clip = clip.expect("a clipped payload says so");
    assert_eq!(clip.original_bytes, huge.len() as u64);
    assert_eq!(
        clip.original_id,
        fingerprint_exact(huge.as_bytes()),
        "the whole payload's content address is what lets a reader match a rerun of the command \
         against the original, from a record that kept a fraction of it"
    );
}

/// Two different payloads that happen to share a tail are two pool entries, not one.
///
/// The dedup keys on the address of the payload **as given**, never on the stored clip — otherwise
/// the second payload would silently resolve to the first one's row, and the record would report a
/// forty-megabyte log's length for a two-line one.
#[test]
fn two_payloads_sharing_a_tail_are_clipped_to_two_pool_entries() {
    let (dir, recorder) = recorder_in(None);
    let tail = "y".repeat(GG_SESSION_STREAM_MAX_BYTES);
    let first = format!("first{tail}");
    let second = format!("second-and-longer{tail}");
    for stdout in [&first, &second] {
        recorder.record_git(
            "root",
            RecordedCommand {
                command: "git log",
                cwd: GgShellCwd::Workspace,
                exit_code: 0,
                stdout,
                stderr: "",
            },
        );
    }
    recorder.finish();

    let lines = journal(&dir);
    let clips: Vec<_> = lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Text { clip, .. } => clip.clone(),
            _ => None,
        })
        .collect();
    assert_eq!(clips.len(), 2, "two payloads, two clip rows: {clips:?}");
    assert_ne!(
        clips[0].text, clips[1].text,
        "each clip row names its own pool entry"
    );
    assert_ne!(
        clips[0].original_bytes, clips[1].original_bytes,
        "and reports its own payload's length, not the other's"
    );
}

/// A payload the **model was shown whole** is recorded whole, even though it is far past the
/// ceiling a subprocess stream is clipped at.
///
/// The two seams record different things: a stream is what a process printed, of which the model
/// sees the last 16 KiB, while a tool outcome *is* what the model saw. Clipping the second at the
/// first's ceiling recorded a 100 KB file the model read in its entirety as a 32 KiB tail cut
/// mid-file — so the record said the model read a fragment of a file it had read whole, which is
/// the one thing a record of a tool outcome must not get wrong.
#[test]
fn a_standard_capture_records_a_whole_file_read_without_clipping_it() {
    let (dir, recorder) = recorder_in(None);
    // Three times the stream ceiling, and comfortably under `read_file`'s own 256 KiB cap: the
    // exact band the single old ceiling got wrong.
    let file = "x".repeat(GG_SESSION_STREAM_MAX_BYTES * 3);
    recorder.record_tool_result(
        "root",
        &tool_call("c1", "read_file"),
        &ToolOutcome::ok(file.clone(), "read 98304 bytes"),
    );
    recorder.finish();

    let lines = journal(&dir);
    let texts: Vec<_> = lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Text { text, clip, .. } => Some((text.len(), clip.is_some())),
            _ => None,
        })
        .collect();
    assert!(
        texts.contains(&(file.len(), false)),
        "the file is stored whole, with no clip row: {texts:?}"
    );
}

/// A tool payload past **the tool ceiling** is still clipped — the fidelity axis did not disappear
/// at this seam, it moved.
#[test]
fn a_standard_capture_still_clips_a_tool_payload_past_the_tool_ceiling() {
    let (dir, recorder) = recorder_in(None);
    let huge = "x".repeat(GG_SESSION_TOOL_MAX_BYTES + 1);
    recorder.record_tool_result(
        "root",
        &tool_call("c1", "read_file"),
        &ToolOutcome::ok(huge.clone(), "read a very large file"),
    );
    recorder.finish();

    let clip = journal(&dir)
        .into_iter()
        .find_map(|line| match line {
            GgJournalLine::Text { clip, .. } => clip,
            _ => None,
        })
        .expect("a payload past the tool ceiling is clipped");
    assert_eq!(clip.original_bytes, huge.len() as u64);
}

/// A `read_file`'s structured payload repeats the file body a second time, and that copy is
/// **pooled with the first** rather than inlined beside it.
///
/// Inline it would be the one payload in the record that is neither deduped nor clipped: five
/// reads of the same 100 KB file would store it five times, uncompressed, in a format whose whole
/// premise is that a payload is stored once. Pooled, the body and the outcome's `output` are the
/// same string and therefore the same pool entry — the second copy is free.
#[test]
fn a_structured_file_payload_is_pooled_with_the_output_it_duplicates() {
    let (dir, recorder) = recorder_in(None);
    let file = "hello, file\n".repeat(64);
    let outcome = ToolOutcome::ok(file.clone(), "read 768 bytes").with_data(ApiData::FileText(
        crate::tools::FileTextData {
            contents: file.clone(),
            first_line: 1,
            last_line: 64,
            total_lines: 64,
            byte_truncated: false,
        },
    ));
    for call in 0..5 {
        recorder.record_tool_result(
            "root",
            &tool_call(&format!("c{call}"), "read_file"),
            &outcome,
        );
    }
    recorder.finish();

    let lines = journal(&dir);
    let bodies = lines
        .iter()
        .filter(|line| matches!(line, GgJournalLine::Text { text, .. } if text == &file))
        .count();
    assert_eq!(
        bodies, 1,
        "five reads of one file write the body to the journal exactly once"
    );

    let entry = entries(&lines)[0];
    let GgSessionEntryKind::ToolResult { outcome, .. } = &entry.kind else {
        panic!("a tool result");
    };
    assert_eq!(
        outcome.data_text,
        Some(outcome.output),
        "the lifted body resolves to the very pool entry `output` took"
    );
    // `ApiData` is adjacently tagged, so the payload sits under `data` beside its `kind`.
    let data = outcome.data.as_ref().expect("the structured payload");
    assert_eq!(
        data.pointer("/kind").and_then(Value::as_str),
        Some("fileText"),
        "the variant is still named, which is what drives the restore"
    );
    assert_eq!(
        data.pointer("/data/contents").and_then(Value::as_str),
        Some(""),
        "and the inline copy is gone — the record holds one answer to what the tool returned, not \
         two that can disagree"
    );
    assert_eq!(
        data.pointer("/data/totalLines").and_then(Value::as_u64),
        Some(64),
        "while everything a reader actually branches on stays inline"
    );
}

/// The working directory a recorded command ran in is stored **relative to the workspace**, so a
/// reader comparing two runs that built in different directories still sees one path — and a path
/// genuinely outside the workspace is kept verbatim rather than silently matched.
#[test]
fn a_recorded_working_directory_is_relative_to_the_workspace_where_it_can_be() {
    let workspace = Path::new("/work/impl");
    assert_eq!(shell_cwd(workspace, workspace), GgShellCwd::Workspace);
    assert_eq!(
        shell_cwd(workspace, &workspace.join("web/src")),
        GgShellCwd::Relative {
            path: "web/src".to_string()
        }
    );
    assert_eq!(
        shell_cwd(workspace, Path::new("/work/.gg-worktrees/issue-1")),
        GgShellCwd::Absolute {
            path: "/work/.gg-worktrees/issue-1".to_string()
        },
        "a worktree beside the workspace has nothing to relativize against, and saying so is the \
         point"
    );
}

// --- the turn-boundary probes -----------------------------------------------

/// The cancel probe and the deadline clock both end sessions, and neither is derivable from
/// anything else the record holds.
#[test]
fn the_turn_boundary_probes_are_recorded_as_inputs() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_cancel_probe("root", false);
    recorder.record_clock("root", 1_500, Some(598_500));
    recorder.record_cancel_probe("root", true);
    recorder.finish();

    let lines = journal(&dir);
    let kinds: Vec<&GgSessionEntryKind> = entries(&lines).iter().map(|entry| &entry.kind).collect();
    assert!(matches!(
        kinds[0],
        GgSessionEntryKind::CancelProbe { canceled: false }
    ));
    assert!(matches!(
        kinds[1],
        GgSessionEntryKind::Clock {
            elapsed_ms: 1_500,
            remaining_ms: Some(598_500)
        }
    ));
    assert!(
        matches!(kinds[2], GgSessionEntryKind::CancelProbe { canceled: true }),
        "the probe that fired is the input that ends the session"
    );
}

/// The deadline clock is recorded because it is the one clock read the loop *branches* on: the run
/// stops at the turn boundary where the budget is spent, so a record that dropped it could not
/// explain why the session ended where it did.
#[test]
fn the_deadline_clock_is_recorded() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_clock("root", 42, None);
    recorder.finish();

    assert!(
        entries(&journal(&dir))
            .iter()
            .any(|entry| matches!(entry.kind, GgSessionEntryKind::Clock { .. })),
    );
}

// ---------------------------------------------------------------------------
// The shell decorator
// ---------------------------------------------------------------------------

/// Every one of gg's three command paths reaches the record, under the origin the caller stamped.
///
/// The decorator is what makes that possible: only one of the three paths — a
/// [hook's](crate::hooks) command, the one gg runs *without the model asking* — runs at a call
/// site that holds a recorder, so capturing anywhere but the shared seam would leave a session
/// that used the `shell` tool with no answer for a single one of its commands.
#[tokio::test]
async fn the_shell_decorator_records_every_command_path_under_its_own_origin() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let runner = RecordingShellRunner::new(
        crate::tools::real_shell(),
        Arc::clone(&recorder),
        dir.path(),
    );

    for (origin, command) in [
        (GgShellOrigin::Tool, "printf tool"),
        (GgShellOrigin::Program, "printf program"),
        (GgShellOrigin::Hook, "printf hook"),
    ] {
        runner
            .run(ShellRequest {
                command: command.to_string(),
                cwd: dir.path().to_path_buf(),
                timeout: std::time::Duration::from_secs(30),
                agent_id: "root".to_string(),
                origin,
            })
            .await;
    }
    recorder.finish();

    let lines = journal(&dir);
    let recorded: Vec<(&GgShellOrigin, &str)> = entries(&lines)
        .iter()
        .filter_map(|entry| match &entry.kind {
            GgSessionEntryKind::Shell { origin, command } => {
                Some((origin, command.command.as_str()))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        recorded,
        vec![
            (&GgShellOrigin::Tool, "printf tool"),
            (&GgShellOrigin::Program, "printf program"),
            (&GgShellOrigin::Hook, "printf hook"),
        ],
    );
}

/// The decorator measures a command's directory against the **agent's** root, and pins what the
/// process actually did.
///
/// The root it measures against is the whole reason there is one of these per agent rather than one
/// per run: an agent working in an [issue worktree](crate::board) has its own, and a command it ran
/// in `web/` has to read back as `web/` rather than as `worktrees/AUTH-1/web/` — otherwise the same
/// command issued by two agents records as two different commands and a reader comparing them sees
/// a difference that is not there.
#[tokio::test]
async fn the_shell_decorator_relativizes_against_the_agents_own_root() {
    let (dir, recorder) = recorder_in(None);
    let agent_root = dir.path().join("worktrees").join("AUTH-1");
    std::fs::create_dir_all(agent_root.join("web")).expect("the agent's tree");
    let recorder = Arc::new(recorder);
    let runner = RecordingShellRunner::new(
        crate::tools::real_shell(),
        Arc::clone(&recorder),
        &agent_root,
    );

    let execution = runner
        .run(ShellRequest {
            command: "printf built; printf oops >&2; exit 4".to_string(),
            cwd: agent_root.join("web"),
            timeout: std::time::Duration::from_secs(30),
            agent_id: "agent-1".to_string(),
            origin: GgShellOrigin::Tool,
        })
        .await;
    assert_eq!(
        execution.stdout, "built",
        "and it passes the result through"
    );
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    let Some(GgSessionEntryKind::Shell { command, .. }) =
        entries.iter().map(|entry| &entry.kind).next()
    else {
        panic!("the command was recorded: {entries:?}");
    };
    assert_eq!(
        command.cwd,
        GgShellCwd::Relative {
            path: "web".to_string()
        },
        "relative to the agent's root, not to the run's",
    );
    assert_eq!(command.exit_code, 4);
    assert_eq!(entries[0].agent_id, "agent-1");
}

/// A command that never started is still recorded, as exit `-1` with empty streams: the record's
/// field is a plain `i32` and every consumer of it branches on "zero or not", so what the record
/// has to say is that the command did not succeed.
#[tokio::test]
async fn a_command_that_never_started_is_still_recorded() {
    let (dir, recorder) = recorder_in(None);
    let recorder = Arc::new(recorder);
    let runner = RecordingShellRunner::new(
        crate::tools::real_shell(),
        Arc::clone(&recorder),
        dir.path(),
    );

    let execution = runner
        .run(ShellRequest {
            command: "printf nope".to_string(),
            // A directory that does not exist: `sh` cannot be spawned there.
            cwd: dir.path().join("no-such-directory"),
            timeout: std::time::Duration::from_secs(30),
            agent_id: "root".to_string(),
            origin: GgShellOrigin::Tool,
        })
        .await;
    assert!(matches!(execution.status, ShellStatus::LaunchFailed { .. }));
    recorder.finish();

    let lines = journal(&dir);
    let entries = entries(&lines);
    let Some(GgSessionEntryKind::Shell { command, .. }) =
        entries.iter().map(|entry| &entry.kind).next()
    else {
        panic!("a command that never ran is still an input the run consumed: {entries:?}");
    };
    assert_eq!(command.exit_code, -1);
}
