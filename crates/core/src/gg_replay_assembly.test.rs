//! Tests for [host-side assembly](super): what a journal becomes, what damage it
//! survives, and what damage it is refused for.
//!
//! Journals under test are built through the **real** streaming interner rather than by
//! hand, so the pool lines, the indices and the fingerprints are exactly the ones a
//! recording session writes — the two sides of the format cannot drift apart in a test
//! that constructs one of them itself.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use super::*;
use crate::gg::GgCapabilitySet;
use crate::gg_replay::{
    GgClientRole, GgReplayCommand, GgReplayInterner, GgReplayRecord, GgReplayRequestShape,
    GgReplayToolCall, GgReplayToolOutcome, GgShellCwd, GgShellOrigin,
};
use crate::gg_replay_journal::GgJournalInterner;

// --- building a journal -----------------------------------------------------

fn message(role: &str, content: &str) -> Value {
    json!({ "role": role, "content": content })
}

/// The header a recording session writes first.
fn header() -> GgJournalLine {
    GgJournalLine::Header {
        format_version: GG_REPLAY_FORMAT_VERSION,
        session_id: "run-1".to_string(),
        capability_set: Box::new(GgCapabilitySet::minimal("some/model")),
        recorder: GgReplayRecorder {
            gg_version: Some("0.7.0".to_string()),
            commit: None,
        },
    }
}

fn entry(seq: u64, kind: GgReplayEntryKind) -> GgJournalLine {
    GgJournalLine::Entry {
        entry: Box::new(GgReplayEntry {
            agent_id: "root".to_string(),
            seq,
            kind,
        }),
    }
}

/// A session that made one model call and one tool call, as the recorder would have
/// written it: each entry preceded by the bodies it newly interned.
fn session() -> Vec<GgJournalLine> {
    let mut interner = GgJournalInterner::new();
    let mut lines = vec![header()];

    let request = interner.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[message("system", "you are gg"), message("user", "build it")],
        Some(&json!([{ "name": "shell" }])),
    );
    lines.extend(interner.take_pending());
    lines.push(entry(
        0,
        GgReplayEntryKind::ModelIo {
            request,
            response: json!({ "text": "on it", "toolCalls": [] }),
        },
    ));

    let output = interner.intern_text("ok");
    let image = interner.intern_blob("image/png", 3, "AAA=");
    lines.extend(interner.take_pending());
    lines.push(entry(
        1,
        GgReplayEntryKind::ToolResult {
            call: GgReplayToolCall {
                id: "call-1".to_string(),
                name: "shell".to_string(),
                arguments: json!({ "command": "ls" }),
                cwd: Some(GgShellCwd::Workspace),
            },
            outcome: GgReplayToolOutcome {
                ok: true,
                output,
                summary: None,
                images: vec![image],
                data: None,
                failure: None,
            },
        },
    ));
    lines
}

/// The terminating line a complete capture writes.
fn end(entries: u64) -> GgJournalLine {
    GgJournalLine::End {
        entries,
        truncation: None,
    }
}

/// Write `lines` as NDJSON into a journal file under `dir`.
fn write_journal(dir: &Path, lines: &[GgJournalLine]) -> PathBuf {
    let path = dir.join("replay.ndjson");
    write_journal_at(&path, lines);
    path
}

/// Write `lines` as NDJSON at exactly `path`, creating its parent.
fn write_journal_at(path: &Path, lines: &[GgJournalLine]) {
    std::fs::create_dir_all(path.parent().expect("a parent")).expect("the journal's directory");
    let mut file = std::fs::File::create(path).expect("create the journal");
    for line in lines {
        let json = serde_json::to_string(line).expect("serialize a journal line");
        writeln!(file, "{json}").expect("write a journal line");
    }
}

/// Read back an assembled artifact, through the same gzip + `Deserialize` path the
/// console and a replay driver use.
fn read_record(path: &Path) -> GgReplayRecord {
    let bytes = std::fs::read(path).expect("read the assembled record");
    assert_eq!(
        &bytes[..2],
        &[0x1f, 0x8b],
        "the artifact should be gzipped — the whole run-tree convention assumes it",
    );
    let mut json = String::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_string(&mut json)
        .expect("decompress the assembled record");
    serde_json::from_str(&json).expect("deserialize the assembled record")
}

/// A scratch run tree, and the artifact path inside it.
fn output_in(dir: &Path) -> PathBuf {
    dir.join("run-1").join(GG_REPLAY_TREE_ARTIFACT)
}

// --- the happy path ---------------------------------------------------------

#[test]
fn a_complete_journal_assembles_into_the_record_it_captured() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(assembly.entries, 2);
    assert_eq!(assembly.truncation, None);
    let record = read_record(&output);
    assert_eq!(record.format_version, GG_REPLAY_FORMAT_VERSION);
    assert_eq!(record.session_id, "run-1");
    assert_eq!(
        record.capability_set,
        GgCapabilitySet::minimal("some/model"),
        "the record runs under the configuration the session was captured with",
    );
    assert_eq!(
        record.recorder.gg_version.as_deref(),
        Some("0.7.0"),
        "which build captured is carried through, explanatory only",
    );
    // Two distinct messages, one toolset, one tool output, one image — the pools the
    // interner minted, in the order it minted them.
    assert_eq!(record.messages.len(), 2);
    assert_eq!(record.messages[0].body, message("system", "you are gg"));
    assert_eq!(record.toolsets.len(), 1);
    assert_eq!(record.texts, vec!["ok".to_string()]);
    assert_eq!(record.blobs.len(), 1);
    assert_eq!(record.blobs[0].data_base64, "AAA=");
    assert_eq!(
        record
            .entries
            .iter()
            .map(|entry| entry.seq)
            .collect::<Vec<_>>(),
        vec![0, 1],
    );
    match &record.entries[0].kind {
        GgReplayEntryKind::ModelIo { request, .. } => {
            assert_eq!(request.messages, vec![0, 1]);
            assert_eq!(request.toolset, Some(0));
            assert_eq!(
                request.fingerprint.system.as_deref(),
                Some(record.messages[0].id.as_str()),
                "the fingerprint the recorder stamped survives assembly verbatim",
            );
        }
        other => panic!("expected the model turn first, got {other:?}"),
    }
    assert!(record.truncation.is_none());
}

#[test]
fn the_document_carries_every_field_the_record_serializes() {
    // Assembly writes the document field by field (the arrays never exist in memory at
    // once, so `serde_json` cannot write it), which is the one thing about the format
    // that can silently drift from the type. A field added to the record and forgotten
    // here would deserialize as its `#[serde(default)]` — silently, and forever.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let bytes = std::fs::read(&output).expect("read the artifact");
    let mut json = String::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_string(&mut json)
        .expect("decompress");
    let assembled: serde_json::Map<String, Value> =
        serde_json::from_str(&json).expect("the document is a JSON object");
    let serialized = serde_json::to_value(GgReplayRecord::new(
        "run-1",
        GgCapabilitySet::minimal("some/model"),
    ))
    .expect("serialize an empty record");
    let expected = serialized.as_object().expect("an object");

    assert_eq!(
        assembled.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>(),
        "the hand-written document and the record type must carry the same fields",
    );
}

#[test]
fn a_reported_ceiling_truncation_survives_assembly() {
    // Capture that stopped deliberately is not damage: the journal is well-formed, and
    // the reason the recorder gave is the record's own explanation of why it is short.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(GgJournalLine::End {
        entries: 2,
        truncation: Some(GgReplayTruncation {
            reason: GgReplayTruncationReason::ByteCeiling,
            last_seq: Some(1),
            bytes: Some(4096),
        }),
    });
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgReplayTruncation {
            reason: GgReplayTruncationReason::ByteCeiling,
            last_seq: Some(1),
            bytes: Some(4096),
        }),
    );
    assert_eq!(read_record(&output).truncation, assembly.truncation);
}

// --- damage that is reported ------------------------------------------------

#[test]
fn a_journal_without_its_end_line_is_a_killed_session() {
    // The `End` line's *absence* is the only signal a killed gg can leave: it had no
    // opportunity to write a self-report either.
    let dir = tempfile::tempdir().expect("scratch");
    let journal = write_journal(dir.path(), &session());
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgReplayTruncation {
            reason: GgReplayTruncationReason::SessionKilled,
            last_seq: Some(1),
            bytes: None,
        }),
    );
    assert_eq!(
        assembly.entries, 2,
        "everything that reached the journal is still served",
    );
    assert_eq!(read_record(&output).entries.len(), 2);
}

#[test]
fn a_torn_final_line_keeps_everything_before_it() {
    let dir = tempfile::tempdir().expect("scratch");
    let journal = write_journal(dir.path(), &session());
    // A batch that was still being written when the process stopped: a complete prefix
    // and no terminating newline.
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&journal)
        .expect("reopen the journal");
    file.write_all(br#"{"type":"entry","entry":{"agentId":"root","seq":2,"#)
        .expect("write a torn line");
    drop(file);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgReplayTruncation {
            reason: GgReplayTruncationReason::CorruptJournal,
            last_seq: Some(1),
            bytes: None,
        }),
        "the record is corrupt at the last complete entry, not at the torn one",
    );
    assert_eq!(read_record(&output).entries.len(), 2);
}

#[test]
fn an_end_line_that_disagrees_with_the_walk_is_a_corrupt_journal() {
    // The count exists to be disagreed with: a record that holds fewer entries than the
    // recorder says it wrote is missing some in the middle, which no walk can see.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(7));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(
        assembly.truncation,
        Some(GgReplayTruncation {
            reason: GgReplayTruncationReason::CorruptJournal,
            last_seq: Some(1),
            bytes: None,
        }),
    );
}

// --- damage that is refused -------------------------------------------------

#[test]
fn a_pool_index_that_skips_is_refused_rather_than_assembled() {
    // The failure this prevents is silent: with a hole in the pool, the entry asking for
    // message 1 would be handed message 0's body and the record would read as complete.
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    for line in &mut lines {
        if let GgJournalLine::Message { index, .. } = line
            && *index == 1
        {
            *index = 2;
        }
    }
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a gap is refused");

    assert!(
        error.to_string().contains("gap in its message pool"),
        "the error should name the pool that skipped: {error}",
    );
    assert!(
        !output.exists(),
        "no artifact at all is better than one that describes a conversation that never happened",
    );
}

#[test]
fn an_entry_referencing_past_a_pool_is_refused_rather_than_assembled() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = vec![header()];
    lines.push(entry(
        0,
        GgReplayEntryKind::Git {
            command: GgReplayCommand {
                command: "git status".to_string(),
                cwd: GgShellCwd::Workspace,
                exit_code: 0,
                // Nothing has been interned, so both streams dangle.
                stdout: 0,
                stderr: 1,
            },
        },
    ));
    lines.push(end(1));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a dangling ref is refused");

    assert!(
        error.to_string().contains("dangling reference"),
        "the error should say what is missing: {error}",
    );
    assert!(!output.exists());
}

#[test]
fn a_journal_from_a_newer_gg_is_refused() {
    // Refused rather than guessed at: a newer journal may hold entry kinds this build has
    // never heard of, and half a session's inputs is not a reconstruction.
    let dir = tempfile::tempdir().expect("scratch");
    let lines = vec![GgJournalLine::Header {
        format_version: GG_REPLAY_FORMAT_VERSION + 1,
        session_id: "run-1".to_string(),
        capability_set: Box::new(GgCapabilitySet::default()),
        recorder: GgReplayRecorder::default(),
    }];
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a newer format is refused");

    assert!(
        error.to_string().contains("does not assemble"),
        "the error should say the format is not this build's: {error}",
    );
    assert!(!output.exists());
}

#[test]
fn a_journal_with_no_header_is_refused() {
    // Without the header there is no session id and no capability set, so there is no
    // record to write — not even an empty one.
    let dir = tempfile::tempdir().expect("scratch");
    let journal = write_journal(dir.path(), &[end(0)]);
    let output = output_in(dir.path());

    let error = assemble_journal_to_gz(&journal, &output).expect_err("a headerless journal");

    assert!(
        error.to_string().contains("no header line"),
        "the error should say the session is unknown: {error}",
    );
}

// --- the scratch files ------------------------------------------------------

#[test]
fn the_scratch_directory_is_on_the_output_volume_and_does_not_survive() {
    // R17: segments cost the journal's size again, so they must never land on a `/tmp`
    // that is a small tmpfs. Deriving the location from the output is the enforcement.
    let dir = tempfile::tempdir().expect("scratch");
    let output = output_in(dir.path());

    let scratch = scratch_beside(&output).expect("a scratch directory");
    assert_eq!(
        scratch.path().parent(),
        output.parent(),
        "scratch must sit beside the artifact, on the same volume as the run tree",
    );
    let path = scratch.path().to_path_buf();
    drop(scratch);
    assert!(!path.exists(), "scratch is transient and cleans itself up");
}

#[test]
fn assembly_leaves_nothing_behind_but_the_artifact() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut lines = session();
    lines.push(end(2));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    assemble_journal_to_gz(&journal, &output).expect("assemble");

    let left: Vec<String> = std::fs::read_dir(output.parent().expect("a run dir"))
        .expect("list the run dir")
        .map(|entry| {
            entry
                .expect("an entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(left, vec![GG_REPLAY_TREE_ARTIFACT.to_string()]);
}

// --- the stage --------------------------------------------------------------

/// A run request for `harness`, with everything else at its least interesting.
fn request(harness: crate::HarnessSlug) -> crate::RunRequest {
    crate::RunRequest {
        test_case_slug: "carom".to_string(),
        test_case_version: Some("v1.0.0".to_string()),
        variant: "base".to_string(),
        harness,
        model_id: "some/model".to_string(),
        orchestrator: crate::OrchestratorSelection::default(),
        max_runtime_override: None,
        container_image: None,
        gg_capability_set: None,
        gg_model_windows: std::collections::BTreeMap::new(),
        gg_model_modalities: std::collections::BTreeMap::new(),
    }
}

/// A resolved case and variant the stage never reads, built through `serde` so a field
/// added to either does not drag this fixture along with it.
fn case() -> (crate::test_case::TestCaseVersion, crate::test_case::Variant) {
    let version = serde_json::from_value(json!({
        "slug": "carom",
        "version": "v1.0.0",
        "name": "Carom",
        "difficulty": "easy",
        "tags": [],
        "summary": null,
        "descriptionPath": null,
        "root": "/tmp/carom",
        "promptPath": "/tmp/carom/prompt.hbs",
        "maxRuntimeSeconds": 3600,
        "commonSpecs": [],
        "commonWorkspace": [],
        "init": null,
        "assetPaths": [],
        "packages": [],
        "variants": [],
        "commonReferences": [],
        "commonProofs": [],
        "checks": [],
        "commonReviewItems": [],
        "domains": [],
        "cases": [],
        "errata": [],
    }))
    .expect("a resolved case");
    let variant = serde_json::from_value(json!({
        "slug": "base",
        "name": "Base",
        "specs": [],
        "references": [],
        "proofs": [],
        "reviewItems": [],
        "domains": [],
    }))
    .expect("a variant");
    (version, variant)
}

/// Drive the stage over a run whose collected tree is `repo_path` and whose run
/// directory is `run_dir`.
async fn drive_stage(
    harness: crate::HarnessSlug,
    repo_path: &Path,
    run_dir: &Path,
) -> Result<PostRunReport> {
    let (version, variant) = case();
    let request = request(harness);
    let artifacts = crate::execution::ArtifactCollection {
        repo_path: repo_path.to_path_buf(),
    };
    GgReplayAssembler
        .run(&PostRunContext {
            run_id: "run-1",
            run_dir,
            artifacts: &artifacts,
            seed_commit: "0123456789abcdef0123456789abcdef01234567",
            test_case: &version,
            variant: &variant,
            request: &request,
            canceled: false,
        })
        .await
}

#[tokio::test]
async fn the_stage_ignores_a_run_from_another_harness() {
    // The seam invokes every wired stage unconditionally, so "this run is not mine" is
    // the stage's own decision — and a Claude Code run's tree has no journal to read.
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    let mut lines = session();
    lines.push(end(2));
    write_journal_at(&repo.join(GG_REPLAY_JOURNAL_PATH), &lines);
    let run_dir = dir.path().join("run-1");

    let report = drive_stage(crate::HarnessSlug::Claude, &repo, &run_dir)
        .await
        .expect("the stage");

    assert_eq!(report, PostRunReport::empty());
    assert!(!run_dir.join(GG_REPLAY_TREE_ARTIFACT).exists());
}

#[tokio::test]
async fn a_gg_run_that_captured_nothing_is_not_a_failure() {
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    std::fs::create_dir_all(&repo).expect("a tree");
    let run_dir = dir.path().join("run-1");
    std::fs::create_dir_all(&run_dir).expect("a run dir");

    let report = drive_stage(crate::HarnessSlug::Gg, &repo, &run_dir)
        .await
        .expect("a missing journal is an absence, not an error");

    assert_eq!(report, PostRunReport::empty());
}

#[tokio::test]
async fn the_stage_lifts_the_journal_out_of_the_collected_tree() {
    // The tree is copied verbatim into the run's `implementation/` and from there into
    // the public per-run repository, so a conversation transcript left inside it would be
    // published — and counted as code the model wrote.
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    let mut lines = session();
    lines.push(end(2));
    write_journal_at(&repo.join(GG_REPLAY_JOURNAL_PATH), &lines);
    let run_dir = dir.path().join("run-1");
    std::fs::create_dir_all(&run_dir).expect("a run dir");

    let report = drive_stage(crate::HarnessSlug::Gg, &repo, &run_dir)
        .await
        .expect("the stage");

    let artifact = run_dir.join(GG_REPLAY_TREE_ARTIFACT);
    assert_eq!(report.artifacts, vec![artifact.clone()]);
    assert!(
        !repo.join(GG_REPLAY_JOURNAL_PATH).exists(),
        "the journal must not survive into the published tree",
    );
    assert_eq!(read_record(&artifact).entries.len(), 2);
}

#[tokio::test]
async fn the_stage_reports_an_unusable_journal_as_a_failure() {
    // Which the seam turns into a warning and a run with no replay artifact — never a
    // failed run.
    let dir = tempfile::tempdir().expect("scratch");
    let repo = dir.path().join("implementation");
    std::fs::create_dir_all(repo.join(".gg")).expect("a tree");
    std::fs::write(repo.join(GG_REPLAY_JOURNAL_PATH), "not a journal\n").expect("a bad journal");
    let run_dir = dir.path().join("run-1");

    let error = drive_stage(crate::HarnessSlug::Gg, &repo, &run_dir)
        .await
        .expect_err("an unusable journal");

    assert!(
        error.to_string().contains("no header line"),
        "the failure should say what was wrong: {error}",
    );
    assert!(
        repo.join(GG_REPLAY_JOURNAL_PATH).exists(),
        "a journal that could not be assembled is left where it is, for a human to read",
    );
}

/// `GgShellOrigin` is part of the entry vocabulary assembly walks; naming it here keeps
/// the reference-checking match's coverage of shell entries honest.
#[test]
fn a_shell_entrys_streams_are_checked_against_the_text_pool() {
    let dir = tempfile::tempdir().expect("scratch");
    let mut interner = GgJournalInterner::new();
    let stdout = interner.intern_text("hello");
    let stderr = interner.intern_text("");
    let mut lines = vec![header()];
    lines.extend(interner.take_pending());
    lines.push(entry(
        0,
        GgReplayEntryKind::Shell {
            origin: GgShellOrigin::Tool,
            command: GgReplayCommand {
                command: "echo hello".to_string(),
                cwd: GgShellCwd::Workspace,
                exit_code: 0,
                stdout,
                stderr,
            },
        },
    ));
    lines.push(end(1));
    let journal = write_journal(dir.path(), &lines);
    let output = output_in(dir.path());

    let assembly = assemble_journal_to_gz(&journal, &output).expect("assemble");

    assert_eq!(assembly.entries, 1);
    assert_eq!(
        read_record(&output).texts,
        vec!["hello".to_string(), String::new()]
    );
}
