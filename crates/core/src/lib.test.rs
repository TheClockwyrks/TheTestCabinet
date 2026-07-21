//! Tests for the crate root: the working-tree copy that produces a run's
//! published `implementation/` directory, and the per-run JSONL stream files.

use std::path::PathBuf;

use super::{
    Error, EventFormat, EventKind, EventParser, HarnessEvent, HarnessOutcome, HarnessSlug,
    MAX_GAME_JAM_README_BYTES, OrchestratorSelection, OutputStream, RawOutputLine, RunRequest,
    RunState, TestCaseVersion, TestType, Usage, build_failed_record, completed_state, copy_tree,
    init_failure_detail, read_game_jam_readme, with_runtime_cap, write_run_streams,
};
use crate::execution::ExecOutput;
use crate::validation::{DebugScriptResult, ValidationSummary};
use time::OffsetDateTime;

#[test]
fn a_debug_api_gate_failure_is_a_validation_error_not_a_catastrophe() {
    // A build that loaded but failed the debug-API gate is unreviewable, but it is
    // NOT catastrophic: it built, loaded, and is still playable, so it gets its own
    // terminal state and keeps its Play tab. Only a build that never loaded is
    // Catastrophic.
    let failed_script = DebugScriptResult {
        item_id: "spin".to_string(),
        sub_item_id: None,
        title: "Spin".to_string(),
        category_title: "Spin".to_string(),
        script: "validation/spin.mjs".to_string(),
        gates: true,
        ran: false,
        precondition_unmet: false,
        detail: Some("window.__demo was not installed".to_string()),
        verdicts: Vec::new(),
        outputs: Vec::new(),
    };
    let gated = ValidationSummary {
        loaded: true,
        debug_scripts: vec![failed_script.clone()],
        ..Default::default()
    };
    assert_eq!(
        completed_state(TestType::EndToEnd, &gated),
        RunState::ValidationError
    );
    // ...and that state keeps the playable build the reviewer needs to open.
    assert!(RunState::ValidationError.has_playable_build());

    // A build that never loaded stays Catastrophic — nothing to host, nothing to
    // review — even when the same gating script also failed to run against it.
    let never_loaded = ValidationSummary {
        loaded: false,
        debug_scripts: vec![failed_script],
        ..Default::default()
    };
    assert_eq!(
        completed_state(TestType::EndToEnd, &never_loaded),
        RunState::Catastrophic
    );
    assert!(!RunState::Catastrophic.has_playable_build());

    // A clean load with no failing scripts completes normally.
    let clean = ValidationSummary {
        loaded: true,
        ..Default::default()
    };
    assert_eq!(
        completed_state(TestType::EndToEnd, &clean),
        RunState::Completed
    );
}

#[test]
fn read_game_jam_readme_captures_only_game_jam_readmes() {
    let dir = tempfile::tempdir().expect("temp dir");
    std::fs::write(dir.path().join("README.md"), "# My Game\n\nHow to play.").expect("write");

    // Captured for a game jam.
    assert_eq!(
        read_game_jam_readme(TestType::GameJam, dir.path()).as_deref(),
        Some("# My Game\n\nHow to play."),
    );
    // Never captured for another test type, even when a README is present.
    assert_eq!(read_game_jam_readme(TestType::FullStack, dir.path()), None);
}

#[test]
fn read_game_jam_readme_treats_missing_or_blank_as_absent() {
    let dir = tempfile::tempdir().expect("temp dir");
    // No README at all.
    assert_eq!(read_game_jam_readme(TestType::GameJam, dir.path()), None);
    // A whitespace-only README is absent, not an empty entry.
    std::fs::write(dir.path().join("README.md"), "   \n\t\n").expect("write");
    assert_eq!(read_game_jam_readme(TestType::GameJam, dir.path()), None);
}

#[test]
fn read_game_jam_readme_truncates_an_oversized_readme_on_a_char_boundary() {
    let dir = tempfile::tempdir().expect("temp dir");
    // A multi-byte char repeated past the cap, so a naive byte cut could split it.
    let big = "é".repeat(MAX_GAME_JAM_README_BYTES);
    std::fs::write(dir.path().join("README.md"), &big).expect("write");

    let captured = read_game_jam_readme(TestType::GameJam, dir.path()).expect("captured");
    // Valid UTF-8 (no split char), bounded, and marked as truncated.
    assert!(captured.len() <= MAX_GAME_JAM_README_BYTES + "\n\n…(README truncated)".len());
    assert!(captured.ends_with("…(README truncated)"));
}

#[test]
fn init_failure_detail_prefers_stderr_and_reports_the_exit_code() {
    let output = ExecOutput {
        exit_code: 7,
        stdout: "installing…\n".to_string(),
        stderr: "npm ERR! missing script: build\n".to_string(),
        idle_timed_out: false,
    };
    let detail = init_failure_detail(&output);
    assert!(detail.contains("code 7"), "{detail}");
    assert!(detail.contains("missing script: build"), "{detail}");
}

#[test]
fn init_failure_detail_falls_back_to_stdout_when_stderr_is_empty() {
    let output = ExecOutput {
        exit_code: 1,
        stdout: "boom on stdout".to_string(),
        stderr: "   \n".to_string(),
        idle_timed_out: false,
    };
    let detail = init_failure_detail(&output);
    assert!(detail.contains("boom on stdout"), "{detail}");
}

/// The two JSONL files must round-trip and, crucially, replaying `raw.jsonl`
/// through a fresh parser must reproduce the events in `events.jsonl`. That
/// replay property is the whole point of recording both files: a run ships the
/// real harness output beside its translation so the parsing can be re-checked.
#[test]
fn run_streams_persist_raw_output_and_translation_for_replay() {
    let lines = [
        (
            OutputStream::Stdout,
            r#"{"type":"thread.started","thread_id":"t-1"}"#,
        ),
        (
            OutputStream::Stdout,
            r#"{"type":"item.completed","item":{"type":"agent_message","text":"hi"}}"#,
        ),
        (
            OutputStream::Stdout,
            r#"{"type":"item.completed","item":{"type":"command_execution","command":"npm test","exit_code":0}}"#,
        ),
        (OutputStream::Stderr, "a diagnostic"),
    ];

    // Translate as a run does, capturing the raw lines and the events together.
    let mut parser = EventParser::new(EventFormat::Codex);
    let mut raw = Vec::new();
    let mut events = Vec::new();
    for (stream, line) in lines {
        raw.push(RawOutputLine {
            stream,
            line: line.to_string(),
        });
        events.extend(parser.ingest(stream, line));
    }

    let dir = tempfile::tempdir().expect("temp dir");
    write_run_streams(dir.path(), &raw, &events).expect("write run streams");

    let raw_back: Vec<RawOutputLine> = std::fs::read_to_string(dir.path().join("raw.jsonl"))
        .expect("read raw.jsonl")
        .lines()
        .map(|line| serde_json::from_str(line).expect("deserialize raw line"))
        .collect();
    assert_eq!(raw_back, raw);

    let events_back: Vec<HarnessEvent> = std::fs::read_to_string(dir.path().join("events.jsonl"))
        .expect("read events.jsonl")
        .lines()
        .map(|line| serde_json::from_str(line).expect("deserialize event line"))
        .collect();
    assert_eq!(events_back, events);

    let mut replay = EventParser::new(EventFormat::Codex);
    let replayed: Vec<EventKind> = raw_back
        .iter()
        .flat_map(|entry| replay.ingest(entry.stream, &entry.line))
        .map(|event| event.kind)
        .collect();
    let original: Vec<EventKind> = events.iter().map(|event| event.kind.clone()).collect();
    assert_eq!(replayed, original);
}

/// A package manager's `.bin/*` entries are symlinks whose script bodies import
/// siblings via paths relative to the link's real location. Dereferencing them
/// during the copy (writing the target's bytes as a plain file) repoints those
/// imports at the wrong directory, which is what broke `npm run dev`. The copy
/// must therefore recreate symlinks as symlinks.
///
/// Unix-only: it relies on `std::os::unix` to create the link, and the
/// behaviour it guards (npm `.bin` symlinks) is a Unix concern.
#[cfg(unix)]
#[test]
fn copy_tree_preserves_symlinks() {
    let src = tempfile::tempdir().expect("src temp dir");
    let real = src.path().join("vite/bin/vite.js");
    std::fs::create_dir_all(real.parent().unwrap()).expect("create real dir");
    std::fs::write(&real, "// cli entry").expect("write real file");

    let bin = src.path().join(".bin");
    std::fs::create_dir_all(&bin).expect("create .bin");
    std::os::unix::fs::symlink("../vite/bin/vite.js", bin.join("vite")).expect("create symlink");

    let dest = tempfile::tempdir().expect("dest temp dir");
    let out = dest.path().join("implementation");
    copy_tree(src.path(), &out).expect("copy tree");

    let link = out.join(".bin/vite");
    let meta = std::fs::symlink_metadata(&link).expect("link metadata");
    assert!(
        meta.file_type().is_symlink(),
        "copied entry must stay a symlink"
    );
    assert_eq!(
        std::fs::read_link(&link).expect("read link"),
        std::path::Path::new("../vite/bin/vite.js"),
        "the link target must be preserved verbatim",
    );
}

/// `node_modules` is regenerated from the lockfile, so it should never be copied
/// into the published implementation. Everything else must still come across.
#[test]
fn copy_tree_skips_node_modules() {
    let src = tempfile::tempdir().expect("src temp dir");
    std::fs::create_dir_all(src.path().join("node_modules/vite")).expect("create node_modules");
    std::fs::write(src.path().join("node_modules/vite/index.js"), "dep").expect("write dep");
    std::fs::create_dir_all(src.path().join("src")).expect("create src");
    std::fs::write(src.path().join("src/main.ts"), "app").expect("write app");
    std::fs::write(src.path().join("package.json"), "{}").expect("write manifest");

    let dest = tempfile::tempdir().expect("dest temp dir");
    let out = dest.path().join("implementation");
    copy_tree(src.path(), &out).expect("copy tree");

    assert!(
        !out.join("node_modules").exists(),
        "node_modules must be skipped"
    );
    assert!(
        out.join("src/main.ts").exists(),
        "source files must be copied"
    );
    assert!(out.join("package.json").exists(), "manifest must be copied");
}

/// Regular files at arbitrary depth are copied with their contents intact.
#[test]
fn copy_tree_copies_nested_files() {
    let src = tempfile::tempdir().expect("src temp dir");
    let nested = src.path().join("a/b/c.txt");
    std::fs::create_dir_all(nested.parent().unwrap()).expect("create nested dirs");
    std::fs::write(&nested, "deep contents").expect("write nested file");

    let dest = tempfile::tempdir().expect("dest temp dir");
    let out = dest.path().join("implementation");
    copy_tree(src.path(), &out).expect("copy tree");

    assert_eq!(
        std::fs::read_to_string(out.join("a/b/c.txt")).expect("read copied file"),
        "deep contents",
    );
}

/// A resolved version carrying `seconds` as its runtime cap; the other fields are
/// irrelevant to the cap and left empty.
fn version_with_cap(seconds: u64) -> TestCaseVersion {
    TestCaseVersion {
        instrumentation: None,
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root: PathBuf::from("/tmp/pong"),
        prompt_path: PathBuf::from("/tmp/pong/prompt.hbs"),
        max_runtime_seconds: seconds,
        test_type: crate::test_case::TestType::EndToEnd,
        build: Some(crate::test_case::BuildCommands {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: crate::test_case::AssetKind::Sprite,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
        errata: Vec::new(),
    }
}

/// A run request for the pong case with the given runtime override.
fn request_with_override(max_runtime_override: Option<u64>) -> RunRequest {
    RunRequest {
        test_case_slug: "pong".to_string(),
        test_case_version: Some("v1.0.0".to_string()),
        variant: "base".to_string(),
        harness: HarnessSlug::Claude,
        model_id: "some-model".to_string(),
        orchestrator: OrchestratorSelection::default(),
        max_runtime_override,
        container_image: None,
    }
}

/// The effective cap is the per-invocation override when set, and otherwise the
/// resolved case's own default — so a run is always bounded either way.
#[test]
fn effective_max_runtime_prefers_the_override_then_the_case_default() {
    let case = version_with_cap(1800);
    assert_eq!(
        request_with_override(None).effective_max_runtime(&case),
        1800,
        "with no override the case's default is in effect",
    );
    assert_eq!(
        request_with_override(Some(120)).effective_max_runtime(&case),
        120,
        "an override replaces the default for this run",
    );
}

/// A minimal successful outcome for exercising the cap without a real harness.
fn ready_outcome() -> HarnessOutcome {
    HarnessOutcome {
        usage: Usage::default(),
        harness_version: None,
        reported_cost: None,
        raw_output: Vec::new(),
        translated_events: Vec::new(),
    }
}

/// A session that finishes inside the cap passes its own result straight through.
#[tokio::test]
async fn runtime_cap_passes_a_session_that_finishes_in_time() {
    let outcome = with_runtime_cap(async { Ok(ready_outcome()) }, 3600, HarnessSlug::Claude)
        .await
        .expect("a session within the cap should pass through");
    assert_eq!(outcome, ready_outcome());
}

/// A session that runs past the cap is stopped and reported as timed out, naming
/// the harness and the cap it exceeded. Paused time auto-advances past the cap so
/// the test does not wait out a real wall-clock timeout.
#[tokio::test(start_paused = true)]
async fn runtime_cap_stops_a_session_that_runs_too_long() {
    let never = std::future::pending::<super::Result<HarnessOutcome>>();
    let err = with_runtime_cap(never, 30, HarnessSlug::Claude)
        .await
        .expect_err("a session past the cap should time out");
    match err {
        Error::RunTimedOut { slug, seconds } => {
            assert_eq!(slug, "claude");
            assert_eq!(seconds, 30);
        }
        other => panic!("expected RunTimedOut, got {other:?}"),
    }
}

/// A failure after the version resolves records the run as `failed` with its real
/// subject and the reason, so it surfaces in the produced-runs listing with
/// enough context to see what was attempted and why it stopped.
#[test]
fn failed_record_captures_subject_and_reason_from_a_resolved_run() {
    let request = request_with_override(None);
    let case = version_with_cap(1800);
    let started = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("start");
    let finished = OffsetDateTime::from_unix_timestamp(1_700_000_042).expect("finish");

    let record = build_failed_record(
        "job-123",
        &request,
        Some(&case),
        started,
        finished,
        RunState::Infrastructure,
        "locating a container runtime: none found",
    );

    assert_eq!(record.id, "job-123");
    assert_eq!(record.status.state, RunState::Infrastructure);
    assert_eq!(
        record.status.detail.as_deref(),
        Some("locating a container runtime: none found"),
    );
    assert_eq!(record.subject.test_case_slug, "pong");
    assert_eq!(record.subject.test_case_version, "v1.0.0");
    assert_eq!(record.subject.test_type, case.test_type);
    assert_eq!(record.subject.variant, "base");
    assert_eq!(record.subject.harness_slug, HarnessSlug::Claude);
    assert_eq!(record.subject.model_id, "some-model");
    // A failed run produced no metrics, validation, or environment.
    assert_eq!(record.metrics, super::RunMetrics::default());
    assert!(!record.validation.loaded);
    assert!(!record.started_at.is_empty() && !record.finished_at.is_empty());
}

/// A failure before the version could be resolved still records a `failed` run,
/// falling back to what the request carried for the subject.
#[test]
fn failed_record_falls_back_to_the_request_when_unresolved() {
    let request = request_with_override(None);
    let now = OffsetDateTime::from_unix_timestamp(1_700_000_000).expect("now");

    let record = build_failed_record(
        "job-9",
        &request,
        None,
        now,
        now,
        RunState::Infrastructure,
        "backend unreachable",
    );

    assert_eq!(record.status.state, RunState::Infrastructure);
    assert_eq!(record.subject.test_case_version, "v1.0.0");
    // Unresolved: the test type defaults rather than guessing.
    assert_eq!(
        record.subject.test_type,
        crate::test_case::TestType::default()
    );
}
