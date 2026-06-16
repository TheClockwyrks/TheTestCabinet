//! Tests for the crate root: the working-tree copy that produces a run's
//! published `implementation/` directory, and the per-run JSONL stream files.

use std::path::PathBuf;

use super::{
    Error, EventFormat, EventKind, EventParser, HarnessEvent, HarnessOutcome, HarnessSlug,
    OutputStream, RawOutputLine, RunRequest, TestCaseVersion, Usage, copy_tree, with_runtime_cap,
    write_run_streams,
};

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
        slug: "pong".to_string(),
        version: "v1.0.0".to_string(),
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        root: PathBuf::from("/tmp/pong"),
        prompt_path: PathBuf::from("/tmp/pong/prompt.hbs"),
        max_runtime_seconds: seconds,
        common_specs: Vec::new(),
        asset_paths: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        checks: Vec::new(),
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
        max_runtime_override,
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
