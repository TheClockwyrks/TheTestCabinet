//! Tests for the crate root: the working-tree copy that produces a run's
//! published `implementation/` directory, and the per-run JSONL stream files.

use super::{
    EventFormat, EventKind, EventParser, HarnessEvent, OutputStream, RawOutputLine, copy_tree,
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
