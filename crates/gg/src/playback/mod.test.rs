//! The playback entrypoint: the workspace guard, the seed, the report, and — the reason the rest
//! of it exists — the **round trip**.
//!
//! The round trip is the only test here that proves the machinery rather than a rule about it. It
//! drives a real session through the real turn loop with a scripted model, captures it with the
//! real recorder, assembles the real record through the host's own assembler, and reconstructs it —
//! then asserts that this build produced the *same session*, on the named
//! [projection](ContextProjection), with wall clock excluded.

use std::path::Path;
use std::time::Duration;

use base64::Engine as _;
use serde_json::{Value, json};
use tempfile::TempDir;
use test_cabinet_core::gg::{GgCapabilitySet, GgSlotBinding};
use test_cabinet_core::gg_replay::{
    GgFingerprintComponent, GgReplayAgent, GgReplayAgentOrigin, GgReplayBlob, GgReplaySeedFile,
};
use test_cabinet_core::gg_replay_journal::GG_REPLAY_JOURNAL_PATH;
use test_cabinet_core::metrics::{Cost, TokenCounts};

use super::*;
use crate::client::{AgentIdentity, ClientFactory, MockClient};
use crate::config::GgInvocation;
use crate::model::{FinishReason, ModelClient, ModelError, ModelResponse, ToolCall};
use crate::tools::real_shell;

/// The context window the round trip's scripted model is measured against. gg has no fallback — a
/// run whose window cannot be resolved does not start — so a driven session states one exactly as a
/// launch does.
const TEST_CONTEXT_WINDOW: u64 = 200_000;

/// The model every session here binds. Offline by prefix, like every other scripted session in the
/// crate.
const MODEL: &str = "mock/roundtrip";

// ---------------------------------------------------------------------------
// Driving a real session
// ---------------------------------------------------------------------------

/// A factory handing every resolution a fresh [`MockClient`] over the same script — the shape a
/// live factory has (one client per agent, each with its own cursor).
struct ScriptFactory {
    script: Vec<ModelResponse>,
}

impl ClientFactory for ScriptFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        Ok(Box::new(MockClient::new(
            binding.model_id.clone(),
            self.script.clone(),
        )))
    }
}

/// A tool-calling turn, with usage and cost on it so the projection's token and cost comparison is
/// over real figures rather than zeroes.
fn call(id: &str, name: &str, arguments: Value) -> ModelResponse {
    ModelResponse {
        text: Some(format!("calling {name}")),
        tool_calls: vec![ToolCall {
            id: id.to_string(),
            name: name.to_string(),
            arguments,
        }],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts {
            uncached_input: Some(900),
            cached_input: None,
            output: Some(40),
            reasoning: None,
        },
        cost: Some(Cost {
            comparable: Some(0.0011),
            actual: Some(0.0011),
        }),
    }
}

/// The terminal, tool-free turn that ends the loop.
fn finish(text: &str) -> ModelResponse {
    ModelResponse {
        text: Some(text.to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts {
            uncached_input: Some(1_200),
            cached_input: None,
            output: Some(30),
            reasoning: None,
        },
        cost: None,
    }
}

/// The script the round trip drives: real tool calls whose effects a playback has to reproduce for
/// itself — a write, a read of what the write made (which is why re-execution has to be real), and
/// a memory the pinned block then carries into every later turn — and a stop.
fn round_trip_script() -> Vec<ModelResponse> {
    vec![
        call(
            "call_write",
            "write_file",
            json!({
                "path": "index.html",
                "contents": "<!doctype html><canvas id=\"game\"></canvas>\n",
            }),
        ),
        call("call_read", "read_file", json!({ "path": "index.html" })),
        call(
            "call_memory",
            "write_memory",
            json!({
                "name": "plan",
                "description": "What I am building.",
                "body": "A single-file canvas game in index.html.",
            }),
        ),
        finish("The page is written and read back. Done."),
    ]
}

/// The invocation a driven session runs under.
fn invocation(dir: &Path, session_id: &str) -> GgInvocation {
    let set = GgCapabilitySet::minimal(MODEL);
    GgInvocation {
        session_id: session_id.to_string(),
        workspace_dir: dir.to_path_buf(),
        prompt: "Build a tiny game.".to_string(),
        model_windows: set
            .bound_model_ids()
            .into_iter()
            .map(|id| (id.to_string(), TEST_CONTEXT_WINDOW))
            .collect(),
        capability_set: set,
        model_modalities: BTreeMap::new(),
        provided_files: Vec::new(),
        cancel_file: None,
    }
}

/// Drive one real session in `dir` and hand back the record it captured **and** the telemetry it
/// emitted — the two halves the round trip compares.
async fn drive(dir: &Path, session_id: &str) -> (GgReplayRecord, Vec<GgTelemetryEvent>) {
    let capture = CapturingSink::new();
    let emitter = Emitter::with_sink(Some(session_id.to_string()), Box::new(capture.clone()));
    let outcome = crate::agent::run_with_seams(
        &invocation(dir, session_id),
        &emitter,
        // A scripted model against the **real** shell: the pairing every loop test in this crate
        // has always run under, and the one a playback then replaces wholesale.
        SessionSeams::substituted(
            Arc::new(ScriptFactory {
                script: round_trip_script(),
            }),
            real_shell(),
        ),
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran, "the driven session launched");
    (assembled_record(dir), capture.events())
}

/// Fold the journal a driven session wrote into the record a host assembles — through the real
/// assembler, so the round trip is over the artifact a run actually produces rather than over an
/// in-memory shortcut.
fn assembled_record(workspace: &Path) -> GgReplayRecord {
    let out = workspace.join("assembled-replay.json.gz");
    test_cabinet_core::gg_replay_assembly::assemble_journal_to_gz(
        &workspace.join(GG_REPLAY_JOURNAL_PATH),
        &out,
    )
    .expect("the journal assembles");
    let record = crate::replay_cli::read_record(&out).expect("the record reads back");
    std::fs::remove_file(&out).expect("the assembled artifact is removed again");
    record
}

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

/// **The round trip.** A recorded session, reconstructed from its own record into an empty
/// directory, produces the same session: no divergence of any kind, and a
/// [context projection](ContextProjection) equal to the original's.
///
/// The projection is what makes the equality both meaningful and achievable: every context message,
/// every prompt's ordered request, its token totals, finish reason and cost, and the terminal
/// summary are compared, while `Prompt::duration_ms` and every `TurnTiming` — the only wall-clock
/// figures in the stream — are excluded. A reconstruction that takes microseconds where the run
/// took seconds legitimately reports different numbers, and a comparison that included them would
/// have to be relaxed by hand until it proved nothing.
#[tokio::test]
async fn a_recorded_session_reconstructs_into_the_same_session() {
    let original = TempDir::new().unwrap();
    let (record, recorded_events) = drive(original.path(), "run-round-trip").await;
    assert!(
        !record.entries.is_empty(),
        "the driven session recorded inputs to reconstruct from",
    );

    let replayed = TempDir::new().unwrap();
    let workspace = replayed.path().join("tree");
    let report = Playback::new(record, &workspace)
        .run()
        .await
        .expect("the record is reconstructible");

    assert!(
        report.divergences.is_empty(),
        "this build still produces the recorded session: {:#?}",
        report.divergences,
    );
    assert!(report.stopped_on.is_none());
    assert!(report.faithful, "no divergence of any kind, under Exact");
    assert_eq!(report.exit_code(), 0);

    let recorded = ContextProjection::project(&recorded_events);
    // Non-vacuity first, because an equality between two empty projections would pass while
    // proving nothing at all — and a reconstruction that failed to launch produces exactly that.
    assert_eq!(
        recorded.prompts.len(),
        5,
        "the driven session took the turns the script wrote",
    );
    assert!(recorded.messages.len() > 8, "and streamed its whole window");
    assert_eq!(
        recorded
            .summary
            .as_ref()
            .map(|summary| summary.terminal_status.as_str()),
        Some("completed"),
        "and ended on its own terms rather than on a ceiling",
    );

    assert_eq!(
        report.context_projection, recorded,
        "the reconstruction's stream is the recorded session's, wall clock excluded",
    );

    // And the reconstruction really did perform its side effects, into its own tree: the write
    // happened here, which is what made the read that followed it read something real.
    assert!(
        workspace.join("index.html").exists(),
        "`write_file` is re-executed for real, which is what makes the next `read_file` valid",
    );
    assert!(
        !original.path().join("tree").exists(),
        "and never into the tree the recorded run produced",
    );
}

/// The wall clock really is excluded, and the round trip above would be a much weaker claim if the
/// two streams were byte-identical to begin with.
///
/// Asserted rather than assumed, because a projection that silently began carrying a clock would
/// turn the round trip red for a reason that has nothing to do with a regression — and the fix
/// somebody reaches for under that pressure is to relax the comparison until it proves nothing.
#[tokio::test]
async fn the_stream_carries_a_wall_clock_the_projection_drops() {
    let original = TempDir::new().unwrap();
    let (record, recorded_events) = drive(original.path(), "run-clock").await;

    let replayed = TempDir::new().unwrap();
    let report = Playback::new(record, replayed.path())
        .run()
        .await
        .expect("the record is reconstructible");

    let recorded_turns = recorded_events
        .iter()
        .filter(|event| matches!(event.kind, GgTelemetryKind::Prompt { .. }))
        .count();
    assert!(recorded_turns > 0, "the recorded stream has turns");
    assert_eq!(
        report.context_projection.prompts.len(),
        recorded_turns,
        "one projected prompt per recorded turn, with the duration dropped from each",
    );
    assert!(
        recorded_events
            .iter()
            .any(|event| matches!(event.kind, GgTelemetryKind::TurnTiming { .. })),
        "and the stream carries the turn timings the projection drops entirely",
    );
}

// ---------------------------------------------------------------------------
// The workspace guard, and what is refused before a reconstruction starts
// ---------------------------------------------------------------------------

/// One blob in the record's pool, content-addressed exactly as the recorder addresses it.
fn seeded_blob(contents: &str) -> GgReplayBlob {
    let data_base64 = BASE64.encode(contents);
    GgReplayBlob {
        id: test_cabinet_core::gg_replay::fingerprint_exact(data_base64.as_bytes()),
        media_type: "text/plain".to_string(),
        bytes: contents.len() as u64,
        data_base64,
    }
}

/// A record with a root in its provenance table, a prompt and a window — enough to launch — and no
/// entries at all, so the root's first turn runs out of record immediately.
///
/// That is not an artificial shape: it is exactly what a run killed before its first response
/// leaves behind, and it reaches every check that happens before the first turn.
fn launchable_record(session_id: &str) -> GgReplayRecord {
    let mut record = GgReplayRecord::new(session_id, GgCapabilitySet::minimal(MODEL));
    record.seed.prompt = "Build a tiny game.".to_string();
    record
        .seed
        .model_windows
        .insert(MODEL.to_string(), TEST_CONTEXT_WINDOW);
    record.agents.push(GgReplayAgent {
        agent_id: "root".to_string(),
        profile: "Root".to_string(),
        origin: GgReplayAgentOrigin::Root,
        terminal_status: None,
        limit_hit: None,
    });
    record
}

/// A playback refuses a workspace that already holds anything — the **strict** rule, stated as a
/// rule rather than as a marker heuristic.
///
/// This is the single guardrail between a playback's real `write_file` and real `git` and a
/// collected run's produced tree, and a produced tree carries none of the obvious markers a
/// heuristic would have looked for. So the refusal has to fire on a directory that looks like
/// nothing in particular, which is what this drives.
#[tokio::test]
async fn a_non_empty_workspace_is_refused() {
    let dir = TempDir::new().unwrap();
    // Deliberately unmarked: no `.git`, no `.gg`, no `node_modules` — a produced tree.
    std::fs::write(dir.path().join("index.html"), "<!doctype html>").unwrap();

    let err = Playback::new(launchable_record("run-dirty"), dir.path())
        .run()
        .await
        .expect_err("a playback builds in an empty directory");

    match err {
        PlaybackError::DirtyWorkspace {
            path,
            count,
            sample,
        } => {
            assert_eq!(path, dir.path());
            assert_eq!(count, 1);
            assert!(sample.contains("index.html"), "actionable: {sample}");
        }
        other => panic!("expected a dirty-workspace refusal, got {other}"),
    }
    assert_eq!(
        std::fs::read_to_string(dir.path().join("index.html")).unwrap(),
        "<!doctype html>",
        "and it wrote nothing at all into the tree it refused",
    );
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        1,
        "not even its own capture journal",
    );
}

/// A workspace that does not exist yet is created, and an existing empty one is accepted.
#[tokio::test]
async fn an_absent_or_empty_workspace_is_prepared() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("a").join("b");
    Playback::new(launchable_record("run-fresh"), &nested)
        .run()
        .await
        .expect("a fresh directory is prepared");
    assert!(nested.is_dir());

    let empty = TempDir::new().unwrap();
    Playback::new(launchable_record("run-empty"), empty.path())
        .run()
        .await
        .expect("an existing empty directory is accepted");
}

/// A record captured before format v2 is refused outright: its fingerprints were derived from a
/// transcript rather than stamped by the recorder, and it carries no provenance table to bind
/// agents through.
///
/// The refusal fires on [`captured_before_v2`](GgReplayRecord::captured_before_v2) rather than on
/// `formatVersion`, which reads `2` on an upgraded record by construction — so this drives an
/// already-upgraded record, which is the only shape one is ever held in.
#[tokio::test]
async fn a_pre_v2_record_is_refused() {
    let dir = TempDir::new().unwrap();
    let mut record = launchable_record("run-old");
    record.upgraded_from = Some(1);
    assert!(
        record.format_version >= 2,
        "the premise: an upgraded record reports v2 and must still be refused",
    );

    let err = Playback::new(record, dir.path())
        .run()
        .await
        .expect_err("a driving reconstruction needs what v2 introduced");
    match err {
        PlaybackError::Unversioned { version } => assert_eq!(version, 1),
        other => panic!("expected an unversioned refusal, got {other}"),
    }
    assert_eq!(
        std::fs::read_dir(dir.path()).unwrap().count(),
        0,
        "refused before a single write",
    );
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/// A relaxed reconstruction says so **four times**: on the root's stream before the first turn, in
/// the report's strictness, in `faithful: false`, and in the exit code.
///
/// The warning is the one a person watching the stream sees, and it is emitted before anything else
/// happens for a reason: `Shape` is the mode somebody reaches for to unblock a red build, and the
/// failure this guards against is reading the result afterwards as a fact about the run.
#[tokio::test]
async fn a_relaxed_reconstruction_says_so_before_the_first_turn() {
    let dir = TempDir::new().unwrap();
    let report = Playback::new(launchable_record("run-shape"), dir.path())
        .strictness(Strictness::Shape)
        .run()
        .await
        .expect("a reconstruction");

    assert_eq!(report.strictness, Strictness::Shape);
    assert!(!report.faithful, "no relaxed reconstruction is faithful");
    assert_eq!(
        report.exit_code(),
        2,
        "distinguishable from a diverged Exact run, which is why the mode is stamped into it",
    );

    let warning_at = report
        .events
        .iter()
        .position(|event| match &event.kind {
            GgTelemetryKind::Log { level, message } => {
                level == "warn" && message.contains("strictness")
            }
            _ => false,
        })
        .expect("the warning is on the stream");
    let GgTelemetryKind::Log { message, .. } = &report.events[warning_at].kind else {
        unreachable!("selected as a log line");
    };
    assert!(message.contains("`shape`"), "it names the mode: {message}");
    assert!(
        message.contains("NOT faithful"),
        "and says what that costs: {message}",
    );
    assert_eq!(
        report.events[warning_at].agent_id.as_deref(),
        Some(ROOT_AGENT_ID),
        "on the root's stream, where a watcher is looking",
    );
    assert!(
        report
            .events
            .iter()
            .position(|event| matches!(event.kind, GgTelemetryKind::Prompt { .. }))
            .is_none_or(|first_turn| warning_at < first_turn),
        "before the first turn",
    );
}

/// An `Exact` reconstruction emits no such warning — the mode that can be faithful does not shout.
#[tokio::test]
async fn an_exact_reconstruction_does_not_warn() {
    let dir = TempDir::new().unwrap();
    let report = Playback::new(launchable_record("run-exact"), dir.path())
        .run()
        .await
        .expect("a reconstruction");

    assert_eq!(report.strictness, Strictness::Exact);
    assert!(
        !report.events.iter().any(|event| matches!(
            &event.kind,
            GgTelemetryKind::Log { level, message }
                if level == "warn" && message.contains("strictness")
        )),
        "no strictness warning under the default",
    );
}

/// A fatal divergence comes back **in the report**, as [`stopped_on`](PlaybackReport::stopped_on) —
/// not as an error that throws away the divergences found before it.
///
/// The reconstruction here runs out of recorded turns on its very first one, which is the shape a
/// run that ended on its wall-clock deadline takes: a playback takes seconds and never reaches one.
#[tokio::test]
async fn a_fatal_divergence_comes_back_in_the_report() {
    let dir = TempDir::new().unwrap();
    let report = Playback::new(launchable_record("run-exhausted"), dir.path())
        .run()
        .await
        .expect("a fatal divergence is still a report");

    let stopped = report
        .stopped_on
        .as_ref()
        .expect("the empty record has no answer for the root's first turn");
    assert_eq!(stopped.kind, DriftKind::RecordExhausted);
    assert!(stopped.fatal);
    assert!(
        report.divergences.contains(stopped),
        "what stopped it is one of the divergences, not a separate channel",
    );
    assert!(!report.faithful);
    assert_eq!(report.exit_code(), 1, "Exact, and it diverged");
    assert!(
        report.summary.is_some(),
        "and the reconstruction still reached a terminal summary, which is what makes the \
         divergences before the stop worth reading",
    );
}

/// An agent the record has a row for that the reconstruction never produced is reported — the
/// other half of the terminal comparison, and the one that catches a fleet that came out smaller
/// than the run's.
#[tokio::test]
async fn an_agent_the_reconstruction_never_produced_is_reported() {
    let dir = TempDir::new().unwrap();
    let mut record = launchable_record("run-missing-agent");
    record.agents.push(GgReplayAgent {
        agent_id: "agent-0".to_string(),
        profile: "Worker".to_string(),
        origin: GgReplayAgentOrigin::Spawn {
            parent: "root".to_string(),
            ordinal: 0,
        },
        // It *ended* in the recorded run, which is what makes its absence comparable.
        terminal_status: Some(GgAgentStatus::Done),
        limit_hit: None,
    });

    let report = Playback::new(record, dir.path())
        .run()
        .await
        .expect("a reconstruction");

    assert!(
        report
            .divergences
            .iter()
            .any(|drift| drift.kind == DriftKind::AgentNotReconstructed),
        "{:?}",
        report.divergences,
    );
    let outcome = report
        .agents
        .iter()
        .find(|agent| agent.agent_id == "agent-0")
        .expect("every recorded agent gets a row in the report");
    assert_eq!(outcome.recorded, Some(GgAgentStatus::Done));
    assert_eq!(outcome.reconstructed, None);
    assert_eq!(outcome.profile, "Worker");
}

// ---------------------------------------------------------------------------
// The seed
// ---------------------------------------------------------------------------

/// The record seeds its own workspace: an empty directory plus a record is a runnable session.
#[tokio::test]
async fn the_seed_writes_its_provided_files_into_the_workspace() {
    let dir = TempDir::new().unwrap();
    let mut record = launchable_record("run-seeded");
    record.blobs.push(seeded_blob("hello"));
    record.seed.provided_files.push(GgReplaySeedFile {
        path: "specs/brief.md".to_string(),
        blob: 0,
    });

    let report = Playback::new(record, dir.path())
        .run()
        .await
        .expect("a reconstruction");

    assert_eq!(
        std::fs::read_to_string(dir.path().join("specs/brief.md")).unwrap(),
        "hello",
    );
    assert!(
        !report
            .divergences
            .iter()
            .any(|drift| drift.kind == DriftKind::Seed),
        "a seed that applied cleanly is not a finding: {:?}",
        report.divergences,
    );
}

/// A seeded path that climbs out of the workspace is **skipped and reported**, never written. A
/// record is gg's own artifact, but this is the one place a record's contents become filesystem
/// writes, and "our own artifact" is not a security boundary.
#[tokio::test]
async fn a_seeded_path_outside_the_workspace_is_refused() {
    let dir = TempDir::new().unwrap();
    let inside = dir.path().join("tree");
    let mut record = launchable_record("run-escape");
    record.blobs.push(seeded_blob("hello"));
    record.seed.provided_files.push(GgReplaySeedFile {
        path: "../escaped.md".to_string(),
        blob: 0,
    });

    let report = Playback::new(record, &inside)
        .run()
        .await
        .expect("a reconstruction");

    assert!(!dir.path().join("escaped.md").exists(), "nothing escaped");
    assert!(
        report
            .divergences
            .iter()
            .any(|drift| drift.kind == DriftKind::Seed),
        "and the reader is told the reconstruction is missing it: {:?}",
        report.divergences,
    );
}

/// A caller-supplied sink sees the same stream the report carries — the report is the product, and
/// a live view of it must not be a second, differently-filtered one.
#[tokio::test]
async fn a_caller_supplied_sink_sees_the_same_stream() {
    let dir = TempDir::new().unwrap();
    let watcher = CapturingSink::new();
    let report = Playback::new(launchable_record("run-tee"), dir.path())
        .sink(Box::new(watcher.clone()))
        .run()
        .await
        .expect("a reconstruction");

    assert_eq!(watcher.events(), report.events);
    assert!(!report.events.is_empty(), "there was a stream to compare");
}

// ---------------------------------------------------------------------------
// Multi-agent: the barrier, the binding table, and board-dispatched agents
// ---------------------------------------------------------------------------

/// The agent topology for the offline **issue-review** end-to-end, driven by the production
/// `DefaultClientFactory`'s `mock/demo-*` scripts.
///
/// It is the shape this milestone exists for: the root files an issue, gg **auto-dispatches** an
/// implementer for it, a reviewer is dispatched to judge the result, the reviewer sends it back, the
/// implementer is re-invoked, and a required merge agent lands it. Three of those agents — the issue
/// attempt, the reviewer and the merge agent — are created by gg itself with **no parent at all**,
/// which is precisely why the [binding table](binding) needs board state and not a spawner.
fn issue_review_set() -> GgCapabilitySet {
    use test_cabinet_core::gg::{
        CAPABILITY_PROJECT_MANAGEMENT, GgAgentConfig, GgCapabilityConfig, GgSubagentRef,
        GgSubagentScope, ROOT_AGENT,
    };
    let mut root = GgAgentConfig {
        model_id: "mock/demo-issue-review-parent".to_string(),
        ..GgAgentConfig::root()
    };
    root.capabilities.push(GgCapabilityConfig {
        params: json!({ "mergeAgent": ROOT_AGENT }),
        ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
    });
    root.subagents = vec![
        GgSubagentRef::new(ROOT_AGENT, &[GgSubagentScope::Implementer]),
        GgSubagentRef::new("reviewer", &[GgSubagentScope::Reviewer]),
    ];
    let reviewer = GgAgentConfig {
        name: "reviewer".to_string(),
        model_id: "mock/demo-review-reviewer".to_string(),
        ..GgAgentConfig::root()
    };
    GgCapabilitySet {
        agents: vec![root, reviewer],
        ..GgCapabilitySet::default()
    }
}

/// An invocation over `set`, with a context window declared for every model it binds.
fn invocation_with(dir: &Path, session_id: &str, set: GgCapabilitySet) -> GgInvocation {
    GgInvocation {
        session_id: session_id.to_string(),
        workspace_dir: dir.to_path_buf(),
        prompt: "Build a tiny game.".to_string(),
        model_windows: set
            .bound_model_ids()
            .into_iter()
            .map(|id| (id.to_string(), TEST_CONTEXT_WINDOW))
            .collect(),
        capability_set: set,
        model_modalities: BTreeMap::new(),
        provided_files: Vec::new(),
        cancel_file: None,
    }
}

/// **The multi-agent round trip.** A recorded, board-dispatched session — issue attempt, reviewer,
/// re-invocation and merge — reconstructs into the same session.
///
/// This is the milestone's headline claim, and it is asserted rather than argued because every
/// piece of it can only be wrong together: the [binding table](binding) has to place three agents
/// gg created with no parent and with ids off a global counter, the [barrier](Ordering::Seq) has to
/// restore the interleaving that a run-global board block is rendered from, the recorded
/// [shell](shell) has to answer per agent, and the [tool comparison](binding) has to keep every
/// re-executed outcome equal to the recorded one. A single one of them wrong shows up here.
///
/// It is driven through `run` — the production `DefaultClientFactory` and its `mock/demo-*` scripts
/// — rather than through an in-crate scripted factory, because the thing under test is gg's real
/// dispatch machinery and a hand-built script could not reach it.
///
/// It is also what turned up the one thing about this path that was not reconstructable at all: a
/// review brief names the **commit** the work is measured against, and a commit id hashes the
/// timestamps as well as the tree — so before gg's own commits were made
/// [content-addressed](crate::git) this passed only when the recorded baseline and the
/// reconstruction's happened to land in the same second.
#[tokio::test]
async fn a_board_dispatched_session_reconstructs_into_the_same_session() {
    let original = TempDir::new().unwrap();
    let capture = CapturingSink::new();
    let emitter = Emitter::with_sink(Some("run-board".to_string()), Box::new(capture.clone()));
    let outcome = crate::agent::run(
        &invocation_with(original.path(), "run-board", issue_review_set()),
        &emitter,
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran, "the driven session launched");
    let record = assembled_record(original.path());
    let recorded_events = capture.events();

    // Non-vacuity: the record really does carry the three parentless board-dispatched rows this
    // test exists for. An assertion about binding them would otherwise pass over an empty set.
    let origins: Vec<&GgReplayAgentOrigin> =
        record.agents.iter().map(|agent| &agent.origin).collect();
    assert!(
        origins
            .iter()
            .any(|origin| matches!(origin, GgReplayAgentOrigin::IssueAttempt { .. })),
        "an auto-dispatched issue attempt: {origins:?}",
    );
    assert!(
        origins
            .iter()
            .any(|origin| matches!(origin, GgReplayAgentOrigin::Reviewer { .. })),
        "a dispatched reviewer: {origins:?}",
    );
    // The issue is dispatched **twice** — once to implement it, once after the review sends it
    // back — and the two dispatches must carry different origins. They are the case that proved
    // keying on the retry count was wrong: a reviewer's rework deliberately does not charge the
    // retry budget, so both agents read as attempt 0 and a reconstruction served the second one the
    // first one's turns. (No merge agent appears here: one is dispatched only for a *conflicted*
    // merge, which this clean cycle never produces. That origin is covered in `binding.test.rs`.)
    let attempts: Vec<u32> = origins
        .iter()
        .filter_map(|origin| match origin {
            GgReplayAgentOrigin::IssueAttempt { attempt, .. } => Some(*attempt),
            _ => None,
        })
        .collect();
    assert_eq!(
        attempts,
        vec![0, 1],
        "two dispatches, two keys: {origins:?}"
    );

    let replayed = TempDir::new().unwrap();
    let report = Playback::new(record, replayed.path().join("tree"))
        .run()
        .await
        .expect("the record is reconstructible");

    assert!(
        report.divergences.is_empty(),
        "this build still produces the recorded multi-agent session: {:#?}",
        report.divergences,
    );
    assert!(report.faithful, "no divergence of any kind, under Exact");
    assert_eq!(
        report.context_projection,
        ContextProjection::project(&recorded_events),
        "the reconstruction's stream is the recorded session's, wall clock excluded",
    );
    // And every recorded agent was placed: a subagent's id comes off a global counter, so this is
    // the assertion that the match was made on provenance rather than on an id that happened to
    // line up.
    for agent in &report.agents {
        assert!(
            agent.reconstructed.is_some(),
            "every recorded agent was bound and reconstructed: {:?}",
            report.agents,
        );
    }
}

// ---------------------------------------------------------------------------
// Responses as code
// ---------------------------------------------------------------------------

/// A single-agent [responses-as-code](crate::sandbox) set, on the production factory's
/// `mock/demo-responses-as-code` script — real program text, compiled and run in the real sandbox.
fn responses_as_code_set() -> GgCapabilitySet {
    use test_cabinet_core::gg::{CAPABILITY_RESPONSES_AS_CODE, GgAgentConfig, GgCapabilityConfig};
    let mut root = GgAgentConfig {
        model_id: "mock/demo-responses-as-code".to_string(),
        ..GgCapabilitySet::minimal("mock/demo-responses-as-code").agents[0].clone()
    };
    root.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_RESPONSES_AS_CODE));
    GgCapabilitySet {
        agents: vec![root],
        ..GgCapabilitySet::default()
    }
}

/// A **responses-as-code** session reconstructs, which means the recorded program really was
/// re-run: the transpiler, the wasmtime sandbox, the typed membrane and the deferred-effect
/// machinery all execute against real recorded model output, in sequence, with the real tool results
/// the program was composing over.
///
/// This is the case the whole feature is most valuable for. gg's responses-as-code loop suite is
/// otherwise driven entirely by hand-written programs — string literals an engineer wrote — and the
/// repeated lesson of this repository is that the assumption a developer knows what a model writes
/// keeps being wrong. The proof that the sandbox really ran is the file the program's `writeFile`
/// left in the reconstruction's own tree.
#[tokio::test]
async fn a_responses_as_code_session_reconstructs_into_the_same_session() {
    use crate::client::MOCK_CODE_LEVEL_FILES;
    let set = responses_as_code_set();

    let original = TempDir::new().unwrap();
    let capture = CapturingSink::new();
    let emitter = Emitter::with_sink(Some("run-code".to_string()), Box::new(capture.clone()));
    let outcome =
        crate::agent::run(&invocation_with(original.path(), "run-code", set), &emitter).await;
    assert_eq!(outcome, SessionOutcome::Ran, "the driven session launched");
    assert!(
        original.path().join(MOCK_CODE_LEVEL_FILES[0]).exists(),
        "the recorded run's program really ran",
    );
    let record = assembled_record(original.path());
    let recorded_events = capture.events();

    let replayed = TempDir::new().unwrap();
    let workspace = replayed.path().join("tree");
    let report = Playback::new(record, &workspace)
        .run()
        .await
        .expect("the record is reconstructible");

    assert!(
        report.divergences.is_empty(),
        "this build still produces the recorded code-mode session: {:#?}",
        report.divergences,
    );
    assert!(report.faithful);
    assert_eq!(
        report.context_projection,
        ContextProjection::project(&recorded_events),
    );
    assert!(
        workspace.join(MOCK_CODE_LEVEL_FILES[0]).exists(),
        "the program was really executed in the sandbox during the reconstruction, not replayed \
         as a transcript — the file it wrote is in the playback's own tree",
    );
    assert_eq!(
        report
            .summary
            .as_ref()
            .map(|summary| summary.execution_mode.as_str()),
        Some("responses_as_code"),
    );
}

// ---------------------------------------------------------------------------
// The ordering barrier, measured
// ---------------------------------------------------------------------------

/// The issue whose dispatched agent answers **slowly** in the recorded run.
const SLOW_ISSUE: &str = "RACE-1";

/// The issue whose dispatched agent answers instantly, and therefore overtakes the slow one.
const FAST_ISSUE: &str = "RACE-2";

/// How long the slow agent's first model call will wait for the fast agent before giving up.
///
/// **Not** the skew itself — the skew is a [rendezvous](RaceRendezvous), not a timer. This is only
/// the escape hatch that turns "the fast agent never finished" from a hung test into the skew
/// assertion failing with its own message, so a real regression is still legible. Nothing that
/// passes ever waits anywhere near it.
const RENDEZVOUS_CEILING: Duration = Duration::from_secs(30);

/// The **happens-before** the recorded race is built on: the fast issue's agent finishes its whole
/// run before the slow issue's agent gets its first answer.
///
/// The skew used to be a 400 ms `sleep` in the slow client, on the reasoning that a handful of mock
/// replies and small file writes could not possibly take that long. They cannot — but the *dispatch*
/// of the second issue can, and every gg agent shares one `current_thread` runtime, so on a
/// contended machine the timer fired before the other agent had been dispatched at all and the
/// recorded interleaving came out un-skewed. That is a flake in the test's own precondition rather
/// than in the barrier, and a precondition asserted after the fact is exactly the thing that should
/// not be left to a race: it is the whole premise of both barrier tests.
///
/// So the wait is on the event itself. The slow client parks until the fast issue's agent has
/// *ended* — every one of its recorded entries is written by then, and the run's `git` is recorded
/// under the root rather than under either issue agent, so "its loop ended" really is "it has
/// nothing left to record". A [`SessionObserver`] is how a test can see that at all: it is the one
/// place a live agent's id and its [provenance](GgReplayAgentOrigin) are both in hand, which is
/// what lets this name the *fast* agent without knowing the id the counter gave it.
#[derive(Debug, Default)]
struct RaceRendezvous {
    /// The live id the run minted for [`FAST_ISSUE`]'s agent, learned at its creation.
    fast_agent: std::sync::Mutex<Option<String>>,
    /// Set once that agent's loop has ended. Read *before* awaiting the notify, so an ending that
    /// lands before the slow client parks is not missed.
    finished: std::sync::atomic::AtomicBool,
    /// Woken when `finished` is set.
    wake: tokio::sync::Notify,
}

impl RaceRendezvous {
    /// Park until the fast issue's agent has ended, or until [`RENDEZVOUS_CEILING`] — see the
    /// constant for why giving up is better than hanging.
    async fn await_fast_agent(&self) {
        let _ = tokio::time::timeout(RENDEZVOUS_CEILING, async {
            loop {
                // Registered before the check, so an ending between the two still wakes this.
                let notified = self.wake.notified();
                if self.finished.load(std::sync::atomic::Ordering::SeqCst) {
                    return;
                }
                notified.await;
            }
        })
        .await;
    }
}

#[async_trait::async_trait]
impl crate::observer::SessionObserver for RaceRendezvous {
    fn agent_created(&self, agent_id: &str, origin: &GgReplayAgentOrigin) {
        if matches!(origin, GgReplayAgentOrigin::IssueAttempt { issue, .. } if issue == FAST_ISSUE)
        {
            *self.fast_agent.lock().expect("rendezvous lock") = Some(agent_id.to_string());
        }
    }

    fn agent_ended(&self, agent_id: &str) {
        let fast = self.fast_agent.lock().expect("rendezvous lock").clone();
        if fast.as_deref() == Some(agent_id) {
            self.finished
                .store(true, std::sync::atomic::Ordering::SeqCst);
            self.wake.notify_waiters();
        }
    }
}

/// A [`ModelClient`] that holds its **first** call until the fast issue's agent has finished.
///
/// The one thing a playback cannot reproduce and does not try to is model latency — that is the
/// entire point of it — so a record whose interleaving was *caused* by latency is exactly the case
/// the [barrier](Ordering::Seq) exists for. This produces one offline: the agent dispatched for
/// [`SLOW_ISSUE`] stands still for the whole of the other issue's agent, so the recorded `seq` order
/// is one that a reconstruction, which answers both instantly, would never reach on its own. The
/// hold is a [rendezvous](RaceRendezvous) rather than a sleep, so the skew is a happens-before and
/// not a bet on how long a contended machine takes to dispatch an agent.
struct SlowClient {
    /// The script underneath. Every call is answered by this; only the wait is added.
    inner: MockClient,
    /// Flipped by the first call, so only the interleaving is skewed rather than the whole run
    /// standing still.
    delayed: std::sync::atomic::AtomicBool,
    /// What the first call waits on.
    rendezvous: Arc<RaceRendezvous>,
}

#[async_trait::async_trait]
impl ModelClient for SlowClient {
    fn model_id(&self) -> &str {
        self.inner.model_id()
    }

    async fn complete(
        &self,
        messages: &[crate::model::Message],
        tools: &[crate::model::ToolDefinition],
    ) -> Result<ModelResponse, ModelError> {
        if !self.delayed.swap(true, std::sync::atomic::Ordering::SeqCst) {
            self.rendezvous.await_fast_agent().await;
        }
        self.inner.complete(messages, tools).await
    }
}

/// A factory that picks a script by the asking agent's **provenance**, and hands the agent
/// dispatched for [`SLOW_ISSUE`] a [slow](SlowClient) one.
///
/// Keying on the origin rather than on a creation counter is what makes the two issue agents
/// distinguishable at all: both are dispatched by gg itself, with no parent, onto the same profile
/// and therefore the same model id. It is also the same key the record stores and the same key a
/// reconstruction binds through, so the two issue agents get the same scripts in the same roles
/// under a playback as they did in the run.
struct BoardRaceFactory {
    /// Handed to the [slow](SlowClient) client, which is the only thing that waits on it.
    rendezvous: Arc<RaceRendezvous>,
}

impl ClientFactory for BoardRaceFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        Ok(Box::new(MockClient::new(
            binding.model_id.clone(),
            board_root_script(),
        )))
    }

    fn client_for_agent(
        &self,
        binding: &GgSlotBinding,
        identity: &AgentIdentity,
    ) -> Result<Box<dyn ModelClient>, ModelError> {
        Ok(match &identity.origin {
            GgReplayAgentOrigin::IssueAttempt { issue, .. } if issue == SLOW_ISSUE => {
                Box::new(SlowClient {
                    inner: MockClient::new(binding.model_id.clone(), slow_issue_script()),
                    delayed: std::sync::atomic::AtomicBool::new(false),
                    rendezvous: Arc::clone(&self.rendezvous),
                })
            }
            GgReplayAgentOrigin::IssueAttempt { .. } => Box::new(MockClient::new(
                binding.model_id.clone(),
                fast_issue_script(),
            )),
            _ => Box::new(MockClient::new(
                binding.model_id.clone(),
                board_root_script(),
            )),
        })
    }
}

/// The root's script: an epic, then **two independent issues**, then a stop.
///
/// Independent is the load-bearing word. Neither issue blocks the other, so gg auto-dispatches both
/// and the two agents are genuinely in flight at the same time — which is the only shape in which
/// the barrier is doing anything at all.
fn board_root_script() -> Vec<ModelResponse> {
    vec![
        call(
            "call_epic",
            "create_epic",
            json!({
                "prefix": "RACE",
                "title": "The build",
                "description": "The work for this session.",
            }),
        ),
        call(
            "call_slow",
            "create_issue",
            json!({
                "title": "The slow half",
                "inScope": "Write the slow half's file.",
                "outOfScope": "Anything else.",
                "completionCriteria": "The file exists.",
                "epicId": "RACE",
                "agent": test_cabinet_core::gg::ROOT_AGENT,
            }),
        ),
        call(
            "call_fast",
            "create_issue",
            json!({
                "title": "The fast half",
                "inScope": "Write the fast half's files.",
                "outOfScope": "Anything else.",
                "completionCriteria": "The files exist.",
                "epicId": "RACE",
                "agent": test_cabinet_core::gg::ROOT_AGENT,
            }),
        ),
        finish("Both issues are filed."),
    ]
}

/// The slow issue agent's script: one file, then a stop.
///
/// Short on purpose. Its second turn is the one the whole test turns on — it is built *after* the
/// other agent has finished in the recorded run and *before* it has under an unordered
/// reconstruction, so its pinned board block is the place the two reconstructions disagree.
fn slow_issue_script() -> Vec<ModelResponse> {
    vec![
        call(
            "call_slow_write",
            "write_file",
            json!({ "path": "slow.txt", "contents": "the slow half\n" }),
        ),
        finish("The slow half is written."),
    ]
}

/// The fast issue agent's script: three files, then a stop.
///
/// Longer than the slow agent's, which is what makes the unordered reconstruction's disagreement
/// robust rather than a coin flip: under [`Free`](Ordering::Free) the slow agent reaches its second
/// turn after a single write, and this agent demonstrably cannot have finished by then.
fn fast_issue_script() -> Vec<ModelResponse> {
    vec![
        call(
            "call_fast_one",
            "write_file",
            json!({ "path": "fast-1.txt", "contents": "one\n" }),
        ),
        call(
            "call_fast_two",
            "write_file",
            json!({ "path": "fast-2.txt", "contents": "two\n" }),
        ),
        call(
            "call_fast_three",
            "write_file",
            json!({ "path": "fast-3.txt", "contents": "three\n" }),
        ),
        finish("The fast half is written."),
    ]
}

/// The capability set the race runs under: a root with the board, and one implementer profile both
/// issues dispatch onto.
fn board_race_set() -> GgCapabilitySet {
    use test_cabinet_core::gg::{
        CAPABILITY_PROJECT_MANAGEMENT, GgAgentConfig, GgCapabilityConfig, GgSubagentRef,
        GgSubagentScope, ROOT_AGENT,
    };
    let mut root = GgAgentConfig {
        model_id: MODEL.to_string(),
        ..GgAgentConfig::root()
    };
    root.capabilities.push(GgCapabilityConfig {
        params: json!({ "mergeAgent": ROOT_AGENT }),
        ..GgCapabilityConfig::enabled(CAPABILITY_PROJECT_MANAGEMENT)
    });
    root.subagents = vec![GgSubagentRef::new(
        ROOT_AGENT,
        &[GgSubagentScope::Implementer],
    )];
    GgCapabilitySet {
        agents: vec![root],
        ..GgCapabilitySet::default()
    }
}

/// Drive the two-issue race once, and hand back the record and the telemetry it emitted.
///
/// Asserts the record's **skew** before handing it over, because every claim either barrier test
/// makes is vacuous without it: what has to be true is that the fast agent's inputs were all
/// recorded *before* the slow agent's second turn, even though the slow agent was dispatched first.
/// That is the interleaving a reconstruction cannot reach on its own, and it is the only reason
/// there is anything for the barrier to restore.
async fn drive_board_race(dir: &Path, session_id: &str) -> (GgReplayRecord, Vec<GgTelemetryEvent>) {
    let rendezvous = Arc::new(RaceRendezvous::default());
    let capture = CapturingSink::new();
    let emitter = Emitter::with_sink(Some(session_id.to_string()), Box::new(capture.clone()));
    let outcome = crate::agent::run_with_seams(
        &invocation_with(dir, session_id, board_race_set()),
        &emitter,
        SessionSeams::substituted(
            Arc::new(BoardRaceFactory {
                rendezvous: Arc::clone(&rendezvous),
            }),
            real_shell(),
        )
        // The rendezvous is the observer: an agent's live id and its provenance are only both in
        // hand here, which is what lets the slow client wait for *the fast issue's* agent without
        // knowing which id the counter gave it.
        .observed_by(Arc::clone(&rendezvous) as Arc<dyn crate::observer::SessionObserver>),
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran, "the driven session launched");
    let record = assembled_record(dir);

    // The two agents the race is between, found by provenance — their ids come off the global
    // counter and are not the thing under test.
    let agent_for = |issue: &str| -> String {
        record
            .agents
            .iter()
            .find(|agent| {
                matches!(&agent.origin, GgReplayAgentOrigin::IssueAttempt { issue: id, .. }
                    if id == issue)
            })
            .unwrap_or_else(|| panic!("an agent was dispatched for {issue}: {:?}", record.agents))
            .agent_id
            .clone()
    };
    let slow = agent_for(SLOW_ISSUE);
    let fast = agent_for(FAST_ISSUE);
    let seqs = |agent: &str| -> Vec<u64> {
        record
            .entries
            .iter()
            .filter(|entry| entry.agent_id == agent)
            .map(|entry| entry.seq)
            .collect()
    };
    let (slow_seqs, fast_seqs) = (seqs(&slow), seqs(&fast));
    assert!(
        slow_seqs.len() >= 2 && !fast_seqs.is_empty(),
        "both agents ran turns to interleave: slow {slow_seqs:?}, fast {fast_seqs:?}",
    );
    // The skew itself: the fast agent's whole recorded queue sits between the slow agent's first
    // and second inputs. `seq` is a *completion* order, so this says exactly what it looks like —
    // the slow agent was still waiting on its first answer for the whole of the other's run.
    assert!(
        fast_seqs.iter().all(|seq| *seq > slow_seqs[0]),
        "the slow agent was dispatched first: slow {slow_seqs:?}, fast {fast_seqs:?}",
    );
    assert!(
        fast_seqs.iter().all(|seq| *seq < slow_seqs[1]),
        "and latency put the whole of the fast agent's run before its second turn: slow \
         {slow_seqs:?}, fast {fast_seqs:?}",
    );

    (record, capture.events())
}

/// **The barrier, measured.** A record whose agents were genuinely in flight at once — and whose
/// interleaving was produced by model latency a reconstruction removes entirely — reconstructs into
/// the same session under [`Seq`](Ordering::Seq).
///
/// This is the strongest claim in the milestone, and it is only worth anything beside its
/// [twin](without_the_barrier_a_concurrent_reconstruction_diverges_on_the_conversation) below,
/// which reconstructs the *same* record with the ordering turned off and watches it diverge. Read
/// together they are a measurement rather than an argument: the barrier is the difference between
/// the two, and a claim about it that could not be turned off would be neither.
#[tokio::test]
async fn a_concurrent_board_record_reconstructs_faithfully_under_the_barrier() {
    let original = TempDir::new().unwrap();
    let (record, recorded_events) = drive_board_race(original.path(), "run-race-seq").await;

    let replayed = TempDir::new().unwrap();
    let report = Playback::new(record, replayed.path().join("tree"))
        .run()
        .await
        .expect("the record is reconstructible");

    assert!(
        report.divergences.is_empty(),
        "the barrier restored the recorded interleaving: {:#?}",
        report.divergences,
    );
    assert!(report.faithful);
    assert_eq!(
        report.context_projection,
        ContextProjection::project(&recorded_events),
        "including every agent's pinned board block, which is what moves when the order does",
    );
}

/// **The same record, with the ordering turned off** — and it is no longer the same session.
///
/// The mechanism is exactly the one the design predicts. A gg run renders run-global mutable state
/// — here the board — into every agent's pinned prompt every turn. The slow agent's second turn was
/// built, in the run, *after* the other issue finished; under [`Free`](Ordering::Free) it is built
/// before, because a reconstruction answers both agents instantly. The recorded response is then an
/// answer to a question this build no longer asked, and under
/// [`Exact`](Strictness::Exact) that is fatal.
#[tokio::test]
async fn without_the_barrier_a_concurrent_reconstruction_diverges_on_the_conversation() {
    let original = TempDir::new().unwrap();
    let (record, _) = drive_board_race(original.path(), "run-race-free").await;

    let replayed = TempDir::new().unwrap();
    let report = Playback::new(record, replayed.path().join("tree"))
        .ordering(Ordering::Free)
        .run()
        .await
        .expect("the record is reconstructible either way");

    assert!(
        !report.faithful,
        "an unordered reconstruction of a concurrent run is a session that did not happen",
    );
    assert!(
        report.divergences.iter().any(|drift| drift.kind
            == DriftKind::Fingerprint(GgFingerprintComponent::Conversation)),
        "and it diverges on the conversation, which is where run-global prompt state lives: {:#?}",
        report.divergences,
    );
}

// ---------------------------------------------------------------------------
// Delegation: a depth-2 spawn, a succession's sibling, and the recorded shell
// ---------------------------------------------------------------------------

/// The profile the root delegates to, which itself delegates again.
const MID_AGENT: &str = "worker";

/// The profile at the bottom of the delegation chain — a **depth-2** spawn, whose provenance names
/// an agent that is not the root.
const LEAF_AGENT: &str = "leaf";

/// A set with three profiles that may all delegate to one another, and a `shell` on each.
///
/// The two things it exists to reach are the two the rest of this file cannot. A
/// [`Spawn`](GgReplayAgentOrigin::Spawn) whose `parent` is **not** the root is the only shape in
/// which that origin carries a counter-minted id, which is what the
/// [origin translation](binding::AgentBindings::recorded_origin) has to undo; and a real `shell`
/// call is the one seam of the four with no recorded-session coverage at all — every other session
/// here reaches the model, the tools and `git`, and none of them runs a command.
fn delegation_set() -> GgCapabilitySet {
    use test_cabinet_core::gg::{
        ALL_SUBAGENT_SCOPES, CAPABILITY_SHELL, CAPABILITY_SUBAGENTS, GgAgentConfig,
        GgCapabilityConfig, GgSubagentRef, ROOT_AGENT, SHELL_OUTPUT_INLINE,
    };
    let mut subagents = GgCapabilityConfig::enabled(CAPABILITY_SUBAGENTS);
    subagents.params = json!({ "maxParallel": 4, "maxDepth": 3 });
    let allowlist: Vec<GgSubagentRef> = [ROOT_AGENT, MID_AGENT, LEAF_AGENT]
        .into_iter()
        .map(|agent| GgSubagentRef {
            agent: agent.to_string(),
            description: String::new(),
            scopes: ALL_SUBAGENT_SCOPES.to_vec(),
        })
        .collect();
    let profile = |name: &str, model: &str| {
        let mut agent = GgAgentConfig {
            name: name.to_string(),
            model_id: model.to_string(),
            subagents: allowlist.clone(),
            ..GgAgentConfig::root()
        };
        agent.capabilities.push(subagents.clone());
        // Inline output, deliberately, rather than the `adaptive` default. Under `adaptive` a
        // command that *succeeds* comes back as the paths its stdout and stderr were written to —
        // and those paths carry the capturing process's pid, so the recorded tool result names a
        // file this reconstruction was never going to write. That is reported correctly (a
        // non-fatal `ToolResult` drift, with the recorded outcome fed forward), but it would be
        // reported on every single command, which would make this fixture's signal noise rather
        // than a regression detector. Inline is the mode whose result is a function of the command.
        agent.capabilities.retain(|cap| cap.id != CAPABILITY_SHELL);
        agent.capabilities.push(GgCapabilityConfig {
            implementation: Some(SHELL_OUTPUT_INLINE.to_string()),
            ..GgCapabilityConfig::enabled(CAPABILITY_SHELL)
        });
        agent
    };
    GgCapabilitySet {
        agents: vec![
            profile(ROOT_AGENT, "mock/delegation-root"),
            profile(MID_AGENT, "mock/delegation-mid"),
            profile(LEAF_AGENT, "mock/delegation-leaf"),
        ],
        ..GgCapabilitySet::default()
    }
}

/// One `spawn_subagent` turn.
fn spawn_turn(id: &str, agent: &str, prompt: &str) -> ModelResponse {
    call(
        id,
        "spawn_subagent",
        json!({ "agent": agent, "prompt": prompt }),
    )
}

/// One `shell` turn — the seam no other committed session reaches.
fn shell_turn(id: &str, command: &str) -> ModelResponse {
    call(id, "shell", json!({ "command": command }))
}

/// The root: delegate, wait, stop.
fn delegation_root_script() -> Vec<ModelResponse> {
    vec![
        spawn_turn("call_mid", MID_AGENT, "Do the middle of the work."),
        call("call_wait_root", "wait_for_subagents", json!({})),
        finish("The delegated work is done."),
    ]
}

/// The middle agent: delegate **again** (the depth-2 spawn), wait, run a command, stop.
fn delegation_mid_script() -> Vec<ModelResponse> {
    vec![
        spawn_turn("call_leaf", LEAF_AGENT, "Do the leaf of the work."),
        call("call_wait_mid", "wait_for_subagents", json!({})),
        shell_turn(
            "call_mid_shell",
            "printf 'mid ran\n' > mid.txt && cat mid.txt",
        ),
        finish("The middle is done."),
    ]
}

/// The leaf: run a command, stop.
fn delegation_leaf_script() -> Vec<ModelResponse> {
    vec![
        shell_turn(
            "call_leaf_shell",
            "printf 'leaf ran\n' > leaf.txt && wc -l leaf.txt",
        ),
        finish("The leaf is done."),
    ]
}

/// A factory keyed on the **profile's model id**, which is what tells the three scripts apart.
///
/// Keyed on the model rather than on the origin, unlike [`BoardRaceFactory`], because here the
/// three agents run three *different* profiles — and because the origins are the thing under test:
/// a factory that had to recognise a depth-2 spawn to answer it would be assuming what the
/// reconstruction has to prove.
struct DelegationFactory;

impl ClientFactory for DelegationFactory {
    fn client_for(&self, binding: &GgSlotBinding) -> Result<Box<dyn ModelClient>, ModelError> {
        let script = match binding.model_id.as_str() {
            "mock/delegation-mid" => delegation_mid_script(),
            "mock/delegation-leaf" => delegation_leaf_script(),
            _ => delegation_root_script(),
        };
        Ok(Box::new(MockClient::new(binding.model_id.clone(), script)))
    }
}

/// Drive the three-deep delegation once, asserting the shape the whole point rests on: a spawn
/// whose parent is **not** the root, and at least one recorded `shell` command.
async fn drive_delegation(dir: &Path, session_id: &str) -> (GgReplayRecord, Vec<GgTelemetryEvent>) {
    let capture = CapturingSink::new();
    let emitter = Emitter::with_sink(Some(session_id.to_string()), Box::new(capture.clone()));
    let outcome = crate::agent::run_with_seams(
        &invocation_with(dir, session_id, delegation_set()),
        &emitter,
        SessionSeams::substituted(Arc::new(DelegationFactory), real_shell()),
    )
    .await;
    assert_eq!(outcome, SessionOutcome::Ran, "the driven session launched");
    let record = assembled_record(dir);

    assert!(
        record.agents.iter().any(|agent| matches!(
            &agent.origin,
            GgReplayAgentOrigin::Spawn { parent, .. } if parent != crate::agent::ROOT_AGENT_ID
        )),
        "the session really produced a spawn below the root — the only origin that carries a \
         counter-minted id: {:?}",
        record.agents,
    );
    assert!(
        record.entries.iter().any(|entry| matches!(
            entry.kind,
            test_cabinet_core::gg_replay::GgReplayEntryKind::Shell { .. }
        )),
        "and it really ran a command, so the recorded shell seam is under a frozen record",
    );

    (record, capture.events())
}

/// **A delegated session reconstructs into the same session** — the two shapes nothing else in the
/// suite reaches: an agent spawned *by a subagent*, and a real `shell` command.
///
/// Every other session here and every committed fixture creates its agents either as the root or
/// off board state, and runs no command at all. This one produces a
/// [`Spawn`](GgReplayAgentOrigin::Spawn) whose parent is another spawned agent — the origin that
/// carries a counter-minted id — and drives both agents through the
/// [recorded shell](shell)'s lookup ladder.
///
/// What it does **not** prove, and the reason
/// [`an_origin_that_names_another_agent_is_translated_before_the_lookup`](binding::tests) exists
/// beside it: this reconstruction happens to mint the *same* ids the run did, because the agents
/// are created in one strictly ordered sequence with nothing concurrent to reorder them. So the
/// origin translation is not under test here — the shape that needs it is. The unit test is where
/// the two vocabularies are made to genuinely disagree.
#[tokio::test]
async fn a_delegated_session_reconstructs_into_the_same_session() {
    let original = TempDir::new().unwrap();
    let (record, recorded_events) = drive_delegation(original.path(), "run-delegation").await;

    let replayed = TempDir::new().unwrap();
    let report = Playback::new(record, replayed.path().join("tree"))
        .run()
        .await
        .expect("the record is reconstructible");

    assert!(
        report.divergences.is_empty(),
        "this build still produces the recorded delegated session: {:#?}",
        report.divergences,
    );
    assert!(report.faithful);
    assert_eq!(
        report.context_projection,
        ContextProjection::project(&recorded_events),
    );
}

/// The **committed fixture suite** — whole sessions recorded by an *earlier* build and checked
/// into the repository, each asserting that this one still reconstructs it.
///
/// Separate from everything above on the one axis that matters: every test in this file records
/// and reconstructs within a single process, so none of them can detect a prompt-template change —
/// the recorder stamps the fingerprint of the request this build built, and then this build builds
/// it again. A fixture is the missing half.
#[path = "fixtures.test.rs"]
mod fixture_tests;
