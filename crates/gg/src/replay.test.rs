//! Tests for [replay capture](super): the streaming journal, the pooling that makes it cheap, and
//! the two properties the whole scheme rests on — capture stops **atomically**, and the journal
//! always says whether it is complete.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde_json::json;
use tempfile::TempDir;
use test_cabinet_core::gg::{GgAgentStatus, GgCapabilitySet};
use test_cabinet_core::gg_replay::{
    GG_REPLAY_BLOB_REF_KEY, GG_REPLAY_FORMAT_VERSION, GG_REPLAY_STANDARD_STREAM_MAX_BYTES,
    GG_REPLAY_STANDARD_TOOL_MAX_BYTES, GgReplayAgentOrigin, GgReplayPools, fingerprint_exact,
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
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
            shape: GgReplayRequestShape::Complete,
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
            shape: GgReplayRequestShape::Complete,
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
    assert!(matches!(entries[0].kind, GgReplayEntryKind::ModelIo { .. }));
    assert!(matches!(
        entries[1].kind,
        GgReplayEntryKind::ToolResult { .. }
    ));
}

// --- provenance: the invocation envelope and the agent table ----------------

/// A workspace file at `path` holding `bytes`, ready to be read into a [seed](RecordedSeed).
fn seed_file(dir: &TempDir, path: &str, bytes: &[u8]) -> PathBuf {
    let absolute = dir.path().join(path);
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent).expect("the seeded file's directory");
    }
    std::fs::write(&absolute, bytes).expect("the seeded file");
    PathBuf::from(path)
}

/// The envelope as the launch hands it over, naming one model with a resolved window and the
/// given vision state.
fn recorded_seed<'a>(
    prompt: &'a str,
    vision: bool,
    provided_files: &'a [RecordedSeedFile],
) -> RecordedSeed<'a> {
    RecordedSeed {
        prompt,
        baseline_commit: Some("abc123"),
        model_windows: BTreeMap::from([("mock/echo".to_string(), 128_000)]),
        model_modalities: BTreeMap::from([(
            "mock/echo".to_string(),
            GgReplayModalities { vision },
        )]),
        provided_files,
    }
}

/// The [seed](GgJournalLine::Seed) lines the journal carries, in write order.
fn seeds(lines: &[GgJournalLine]) -> Vec<&GgReplaySeed> {
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
fn agent_rows(lines: &[GgJournalLine]) -> Vec<&GgReplayAgent> {
    lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Agent { agent } => Some(agent.as_ref()),
            _ => None,
        })
        .collect()
}

#[test]
fn the_seed_records_the_envelope_a_reconstruction_starts_from() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_seed(recorded_seed("Build a tiny game.", true, &[]));
    recorder.finish();

    let lines = journal(&dir);
    let seeds = seeds(&lines);
    assert_eq!(seeds.len(), 1);
    assert_eq!(seeds[0].prompt, "Build a tiny game.");
    assert_eq!(seeds[0].baseline_commit.as_deref(), Some("abc123"));
    assert_eq!(seeds[0].model_windows["mock/echo"], 128_000);
    assert!(seeds[0].model_modalities["mock/echo"].vision);
}

/// The reason the seed is allowed to be self-contained: a seeded file the session also **read**
/// costs the record one integer, because both go through the one blob pool and the pool keys on
/// the payload's content address.
#[test]
fn a_seeded_file_the_session_also_read_is_one_blob_not_two() {
    let (dir, recorder) = recorder_in(None);
    // The same bytes on both sides: base64 `QUJD` is `ABC`, which is what an attached image
    // carries and what the file on disk holds.
    let path = seed_file(&dir, "specs/mockup.png", b"ABC");
    let mut warnings = Vec::new();
    let provided = read_seed_files(dir.path(), std::slice::from_ref(&path), &mut warnings);
    assert!(warnings.is_empty(), "the file is readable and small");

    let mut message = Message::user("look at this");
    message
        .images
        .push(ImageContent::new("image/png", "QUJD", 3));
    recorder.record_model_io(
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
            messages: std::slice::from_ref(&message),
            tools: &[],
            duration_ms: None,
        },
        &stop_response("ok"),
    );
    recorder.record_seed(recorded_seed("Build a tiny game.", true, &provided));
    recorder.finish();

    let lines = journal(&dir);
    assert_eq!(
        pool_indices(&lines, "blob"),
        vec![0],
        "the seeded file lands on the blob the turn already interned",
    );
    let seeds = seeds(&lines);
    assert_eq!(seeds[0].provided_files.len(), 1);
    assert_eq!(seeds[0].provided_files[0].path, "specs/mockup.png");
    assert_eq!(
        seeds[0].provided_files[0].blob, 0,
        "and the seed carries the reference, not a second copy of the bytes",
    );
}

/// Whatever the seed could not carry is said out loud on the launch's warnings. A seed that
/// quietly listed fewer files than the workspace was given is the worst available failure: a
/// reconstruction would seed a *different* workspace and report every consequence as model drift.
#[test]
fn a_provided_file_the_seed_cannot_carry_is_skipped_loudly() {
    let dir = TempDir::new().expect("a temporary workspace");
    let readable = seed_file(&dir, "specs/brief.md", b"build it");
    let oversized = seed_file(
        &dir,
        "assets/huge.bin",
        &vec![0u8; (SEED_FILE_MAX_BYTES + 1) as usize],
    );
    let missing = PathBuf::from("specs/absent.png");
    let mut warnings = Vec::new();

    let files = read_seed_files(dir.path(), &[readable, oversized, missing], &mut warnings);

    assert_eq!(
        files
            .iter()
            .map(|file| file.path.as_str())
            .collect::<Vec<_>>(),
        vec!["specs/brief.md"],
        "only what could be carried",
    );
    assert_eq!(warnings.len(), 2, "and one warning each for the rest");
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("huge.bin") && warning.contains("seed ceiling")),
        "the oversized file is named along with the ceiling it crossed: {warnings:?}",
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("absent.png") && warning.contains("could not be read")),
        "and the unreadable one says so: {warnings:?}",
    );
}

/// The modality state is not a launch fact. A provider that refused an image denies that model for
/// the rest of the run, so the envelope is rewritten at teardown — and assembly keeps the last one.
#[test]
fn a_denial_rewrites_the_envelope_with_the_resolved_modalities() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_seed(recorded_seed("Build a tiny game.", true, &[]));
    recorder.record_resolved_modalities(BTreeMap::from([(
        "mock/echo".to_string(),
        GgReplayModalities { vision: false },
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
    recorder.record_seed(recorded_seed("Build a tiny game.", true, &[]));
    recorder.record_resolved_modalities(BTreeMap::from([(
        "mock/echo".to_string(),
        GgReplayModalities { vision: true },
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
    let born = GgReplayAgent {
        agent_id: "agent-0".to_string(),
        profile: "Worker".to_string(),
        origin: GgReplayAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
        terminal_status: None,
        limit_hit: None,
    };
    recorder.record_agent(born.clone());
    recorder.record_agent(GgReplayAgent {
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
        GgReplayAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
        "and the terminal row repeats the keys the agent is bound by",
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
                shape: GgReplayRequestShape::Complete,
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
            RecordedCall {
                agent_id: "root",
                role: GgClientRole::Agent,
                shape: GgReplayRequestShape::Complete,
                messages: std::slice::from_ref(&message),
                tools: &[],
                duration_ms: None,
            },
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
            messages: &[Message::user("hi")],
            tools: &[],
            duration_ms: None,
        },
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
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
            RecordedCall {
                agent_id: "root",
                role: GgClientRole::Agent,
                shape: GgReplayRequestShape::Complete,
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
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
        RecordedCall {
            agent_id: "root",
            role: GgClientRole::Agent,
            shape: GgReplayRequestShape::Complete,
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

/// A failed model call is an **input**, and one this build records: v1 dropped every one of them,
/// so a reconstruction of a run that recovered from a vision refusal diverged at exactly the turn
/// a developer had opened the record to look at.
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
    let GgReplayEntryKind::ModelError { error, request, .. } = &entries[0].kind else {
        panic!("the refusal is recorded first, got {:?}", entries[0].kind);
    };
    assert_eq!(error.kind, GgReplayModelErrorKind::VisionUnsupported);
    assert_eq!(error.model_id.as_deref(), Some("mock/echo"));
    assert_eq!(
        request.messages.len(),
        1,
        "the request identifies which turn failed"
    );
    assert!(
        matches!(entries[1].kind, GgReplayEntryKind::ModelIo { .. }),
        "the retry that was actually sent follows it, got {:?}",
        entries[1].kind
    );
    assert!(
        entries[0].seq < entries[1].seq,
        "and the ordering is what attaches the turn's prompt frame to the call that was sent"
    );
}

/// Every [`ModelError`] class the loop branches on survives into the record as a class, not as a
/// rendered sentence — a reconstruction has to know that a call failed for a reason that strips
/// images and retries, not merely that it failed.
#[test]
fn every_model_error_class_is_recorded_as_the_class_the_loop_branched_on() {
    let cases = [
        (
            ModelError::MissingApiKey,
            GgReplayModelErrorKind::MissingApiKey,
        ),
        (
            ModelError::Fatal {
                status: 402,
                message: "no credit".to_string(),
            },
            GgReplayModelErrorKind::Fatal,
        ),
        (
            ModelError::RetryExhausted {
                attempts: 4,
                last: "504".to_string(),
            },
            GgReplayModelErrorKind::RetryExhausted,
        ),
        (
            ModelError::Parse("not json".to_string()),
            GgReplayModelErrorKind::Parse,
        ),
    ];
    for (error, expected) in cases {
        let recorded = replay_model_error(&error);
        assert_eq!(recorded.kind, expected);
        assert_eq!(recorded.message, error.to_string());
    }
    assert_eq!(
        replay_model_error(&ModelError::Fatal {
            status: 402,
            message: "no credit".to_string(),
        })
        .status,
        Some(402),
        "the status a fatal error carried is what a reader diagnoses it from"
    );
    assert_eq!(
        replay_model_error(&ModelError::RetryExhausted {
            attempts: 4,
            last: "504".to_string(),
        })
        .attempts,
        Some(4),
        "and the attempt count is what says how much of the run's clock the failure cost"
    );
}

/// gg's **second** model client — the handoff-compaction summarizer — is recorded, on its own
/// queue.
///
/// It was never wrapped at all before this, so every handoff-compaction call in every record
/// captured to date is missing. The [role](GgClientRole) is what makes capturing it *safe*:
/// without the discriminator a summarizer call and the agent's own next turn interleave into one
/// indistinguishable queue and a reconstruction serves the wrong one to whichever asks first.
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
            GgReplayEntryKind::ModelIo { request, .. } => Some(request.role),
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

/// The latency clock is a **full-fidelity** input: it changes no control flow, and a playback
/// removes model latency entirely, so a standard capture spends no bytes on the one number a
/// reconstruction deliberately does not reproduce.
#[tokio::test]
async fn a_call_records_its_latency_only_at_full_fidelity() {
    for (fidelity, expected) in [
        (GgReplayFidelity::Standard, false),
        (GgReplayFidelity::Full, true),
    ] {
        let (dir, recorder) = recorder_at(fidelity, None);
        let recorder = Arc::new(recorder);
        let client = RecordingClient::new(
            Box::new(StubClient::new("mock/echo", stop_response("hi"))),
            Arc::clone(&recorder),
            "root",
        );
        client.complete(&[Message::user("go")], &[]).await.ok();
        recorder.finish();

        let lines = journal(&dir);
        let GgReplayEntryKind::ModelIo { duration_ms, .. } = &entries(&lines)[0].kind else {
            panic!("expected a model-io entry");
        };
        assert_eq!(
            duration_ms.is_some(),
            expected,
            "at {fidelity:?} fidelity the latency clock should{} be recorded",
            if expected { "" } else { " not" }
        );
    }
}

// --- subprocesses: shell, git, and the working directory --------------------

/// A completion gate's validation command runs `sh -c` but never reaches tool dispatch, so before
/// this seam it was recorded nowhere at all — and it decides whether the session may end.
#[test]
fn a_recorded_command_carries_its_origin_streams_and_working_directory() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_shell(
        "root",
        GgShellOrigin::CompletionValidation,
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
    let GgReplayEntryKind::Shell { origin, command } = &entries(&lines)[0].kind else {
        panic!("expected a shell entry");
    };
    assert_eq!(*origin, GgShellOrigin::CompletionValidation);
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

/// gg's own `git` bypassed tool dispatch entirely in v1 and was captured nowhere, so a run that
/// ended in a merge conflict left no trace of the conflict. It is recorded now, with its streams
/// pooled like every other bulky payload.
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
    let GgReplayEntryKind::Git { command } = &entries(&lines)[0].kind else {
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
/// This is what the text pool is for: a speculation's `git diff` patch is recorded as a `git`
/// invocation's stdout *and* quoted into the material its judge is dispatched with, and a tool's
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
    let GgReplayEntryKind::Git { command } = &entries[0].kind else {
        panic!("expected a git entry");
    };
    let GgReplayEntryKind::ToolResult { outcome, .. } = &entries[1].kind else {
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
    let huge = "x".repeat(GG_REPLAY_STANDARD_STREAM_MAX_BYTES * 2);
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
    assert_eq!(text.len(), GG_REPLAY_STANDARD_STREAM_MAX_BYTES);
    let clip = clip.expect("a clipped payload says so");
    assert_eq!(clip.original_bytes, huge.len() as u64);
    assert_eq!(
        clip.original_id,
        fingerprint_exact(huge.as_bytes()),
        "the whole payload's content address is what lets a reconstruction that re-runs the \
         command prove its own output matches, from a record that kept a fraction of it"
    );
}

/// The escalation the `replay` capability now buys: at full fidelity nothing is clipped, so the
/// clip table is empty **by construction** rather than by luck.
#[test]
fn a_full_capture_keeps_every_payload_whole() {
    let (dir, recorder) = recorder_at(GgReplayFidelity::Full, None);
    let huge = "x".repeat(GG_REPLAY_STANDARD_STREAM_MAX_BYTES * 2);
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
    let clipped: Vec<_> = lines
        .iter()
        .filter_map(|line| match line {
            GgJournalLine::Text { text, clip, .. } => Some((text.len(), clip.is_some())),
            _ => None,
        })
        .collect();
    assert!(
        clipped.contains(&(huge.len(), false)),
        "the whole payload is stored, with no clip row: {clipped:?}"
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
    let tail = "y".repeat(GG_REPLAY_STANDARD_STREAM_MAX_BYTES);
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
/// mid-file — and a reconstruction feeding that back presents the model with a different file than
/// the run did, then reports the divergence as model drift.
#[test]
fn a_standard_capture_records_a_whole_file_read_without_clipping_it() {
    let (dir, recorder) = recorder_in(None);
    // Three times the stream ceiling, and comfortably under `read_file`'s own 256 KiB cap: the
    // exact band the single old ceiling got wrong.
    let file = "x".repeat(GG_REPLAY_STANDARD_STREAM_MAX_BYTES * 3);
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
    let huge = "x".repeat(GG_REPLAY_STANDARD_TOOL_MAX_BYTES + 1);
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
/// Inline, it was the one payload in the record that was neither deduped nor clipped: five reads of
/// the same 100 KB file stored it five times, uncompressed, in a format whose whole premise is that
/// per-turn re-serialization of payloads was v1's defect. Pooled, the body and the outcome's
/// `output` are the same string and therefore the same pool entry — the second copy is free.
#[test]
fn a_structured_file_payload_is_pooled_with_the_output_it_duplicates() {
    let (dir, recorder) = recorder_in(None);
    let file = "hello, file\n".repeat(64);
    let outcome = ToolOutcome::ok(file.clone(), "read 768 bytes").with_data(ToolData::FileText(
        crate::tools::FileTextData {
            contents: file.clone(),
            first_line: 1,
            last_line: 64,
            total_lines: 64,
            byte_truncated: false,
            limit_reduced: false,
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
    let GgReplayEntryKind::ToolResult { outcome, .. } = &entry.kind else {
        panic!("a tool result");
    };
    assert_eq!(
        outcome.data_text,
        Some(outcome.output),
        "the lifted body resolves to the very pool entry `output` took"
    );
    // `ToolData` is adjacently tagged, so the payload sits under `data` beside its `kind`.
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
        "while everything a reconstruction actually branches on stays inline"
    );
}

/// The working directory a recorded command ran in is stored **relative to the workspace**, so a
/// reconstruction building in a different directory can still compare it — and a path genuinely
/// outside the workspace is kept verbatim rather than silently matched.
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
    let kinds: Vec<&GgReplayEntryKind> = entries(&lines).iter().map(|entry| &entry.kind).collect();
    assert!(matches!(
        kinds[0],
        GgReplayEntryKind::CancelProbe { canceled: false }
    ));
    assert!(matches!(
        kinds[1],
        GgReplayEntryKind::Clock {
            elapsed_ms: 1_500,
            remaining_ms: Some(598_500)
        }
    ));
    assert!(
        matches!(kinds[2], GgReplayEntryKind::CancelProbe { canceled: true }),
        "the probe that fired is the input that ends the session"
    );
}

/// The deadline clock is recorded at **both** fidelities, unlike the latency clock beside it: it
/// is the one clock read the loop branches on, so a standard capture that dropped it would leave a
/// reconstruction running past the point the run stopped.
#[test]
fn the_deadline_clock_is_recorded_at_standard_fidelity_too() {
    let (dir, recorder) = recorder_in(None);
    recorder.record_clock("root", 42, None);
    recorder.finish();

    assert!(
        entries(&journal(&dir))
            .iter()
            .any(|entry| matches!(entry.kind, GgReplayEntryKind::Clock { .. })),
    );
}
