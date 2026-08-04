//! Tests for the shared replay front end.
//!
//! Two things are being pinned here, and they are different in kind.
//!
//! The first is **what a reconstruction says**. `gg replay` and `tcab gg-replay` render their
//! reports through this one module precisely so a delegated reconstruction and a local one read
//! identically; the assertions below are on that rendered text, because it is the whole reason the
//! module exists.
//!
//! The second is **what a record may be found as**. A run tree holds `replay.json.gz`, the backend
//! serves plain JSON, and a record from before format v2 is a different document shape from a
//! current one. All four combinations reach the driver through [`read_record`], and every one of
//! them has to.

use std::io::Write as _;

use serde_json::json;
use test_cabinet_core::gg::{
    GgCapabilitySet, GgReplayEntryKindV1, GgReplayEntryV1, GgReplayRecordV1,
};
use test_cabinet_core::gg_replay::{
    GgClientRole, GgReplayEntry, GgReplayEntryKind, GgReplayInterner, GgReplayPools,
    GgReplayRequestShape,
};
use test_cabinet_core::metrics::TokenCounts;

use super::*;
use crate::model::{FinishReason, ModelResponse, ToolCall};
use crate::telemetry::CollectingSink;
use crate::tools::ToolOutcome;

/// A one-turn v2 record: the model was asked to build a page and stopped without calling anything.
/// The smallest record that reconstructs, so a test about *reporting* is not also a test about
/// record construction.
fn one_turn_record(session_id: &str) -> GgReplayRecord {
    let mut pools = GgReplayPools::new();
    let request = pools.intern_request(
        GgClientRole::Agent,
        GgReplayRequestShape::Complete,
        &[json!({ "role": "user", "content": "build the page" })],
        Some(&json!([])),
    );
    let response = ModelResponse {
        text: Some("done".to_string()),
        tool_calls: Vec::new(),
        finish_reason: FinishReason::Stop,
        usage: TokenCounts::default(),
        cost: None,
        loop_aborts: 0,
    };
    let parts = pools.into_parts();

    let mut record = GgReplayRecord::new(session_id, GgCapabilitySet::minimal("mock/echo"));
    record.messages = parts.messages;
    record.toolsets = parts.toolsets;
    record.texts = parts.texts;
    record.clips = parts.clips;
    record.blobs = parts.blobs;
    record.entries = vec![GgReplayEntry {
        agent_id: "root".to_string(),
        seq: 0,
        kind: GgReplayEntryKind::ModelIo {
            request,
            response: serde_json::to_value(&response).unwrap(),
            duration_ms: None,
        },
    }];
    record
}

/// The **v1** document the backend still serves for every run captured before format v2 — one model
/// turn that wrote a file, and the tool result answering it.
fn v1_document() -> String {
    let write = ToolCall {
        id: "c1".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "index.html" }),
    };
    let response = ModelResponse {
        text: Some("building".to_string()),
        tool_calls: vec![write.clone()],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        loop_aborts: 0,
    };
    let legacy = GgReplayRecordV1 {
        session_id: "run-legacy".to_string(),
        capability_set: GgCapabilitySet::minimal("mock/echo"),
        entries: vec![
            GgReplayEntryV1 {
                agent_id: "root".to_string(),
                seq: 0,
                kind: GgReplayEntryKindV1::ModelIo {
                    request: json!({
                        "messages": [{ "role": "user", "content": "build the page" }],
                        "tools": [],
                    }),
                    response: serde_json::to_value(&response).unwrap(),
                },
            },
            GgReplayEntryV1 {
                agent_id: "root".to_string(),
                seq: 1,
                kind: GgReplayEntryKindV1::ToolResult {
                    call: serde_json::to_value(&write).unwrap(),
                    outcome: serde_json::to_value(ToolOutcome::ok("wrote it", "wrote it")).unwrap(),
                },
            },
        ],
    };
    serde_json::to_string(&legacy).unwrap()
}

/// Reconstruct into a string, with the telemetry going to a collecting sink rather than the
/// process's stdout.
fn report_to_string(record: GgReplayRecord, report: &ReplayReport<'_>) -> anyhow::Result<String> {
    let mut out = Vec::new();
    reconstruct_and_report_with_sink(record, report, &mut out, Box::new(CollectingSink::new()))?;
    Ok(String::from_utf8(out).expect("the report is UTF-8"))
}

/// A plain-JSON record on disk reads back as itself.
#[test]
fn a_plain_record_file_reads() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("replay.json");
    std::fs::write(
        &path,
        serde_json::to_vec(&one_turn_record("run-plain")).unwrap(),
    )
    .unwrap();

    let record = read_record(&path).expect("a plain record reads");
    assert_eq!(record.session_id, "run-plain");
}

/// A **gzipped** record reads back identically, because a run tree's copy is `replay.json.gz` and
/// asking a developer to unpack it first is a step whose only purpose is to be forgotten.
///
/// The extension is deliberately *wrong* here — the file is named `.json` while holding gzip — to
/// prove the sniff is on the bytes and not on the name, which is what makes a record replay from
/// wherever it was obtained.
#[test]
fn a_gzipped_record_file_reads_through_a_misleading_extension() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("replay.json");
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder
        .write_all(&serde_json::to_vec(&one_turn_record("run-gzipped")).unwrap())
        .unwrap();
    std::fs::write(&path, encoder.finish().unwrap()).unwrap();

    let record = read_record(&path).expect("a gzipped record reads");
    assert_eq!(record.session_id, "run-gzipped");
}

/// [`decompressed`] hands plain bytes back **unchanged**, byte for byte.
///
/// This is what makes the old-binary path correct: `tcab gg-replay --gg <VERSION>` writes these
/// bytes out for an older gg to read, and anything that re-serialized a parsed record would hand
/// that binary a v2 document — having silently upgraded away the v1 shape it was resolved to read.
#[test]
fn decompressing_plain_bytes_preserves_them_exactly() {
    let document = v1_document();
    assert_eq!(
        decompressed(document.as_bytes()).unwrap(),
        document.as_bytes(),
    );
    let round_tripped: GgReplayRecordV1 =
        serde_json::from_slice(&decompressed(document.as_bytes()).unwrap())
            .expect("the bytes are still a v1 document, not an upgraded one");
    assert_eq!(round_tripped.entries.len(), 2);
}

/// A **v1** record reconstructs, behind the older-gg banner.
///
/// Both halves matter. The reconstruction is the compatibility guarantee — every record the backend
/// holds from before format v2 is still readable. The banner is the honesty guarantee: v1 had no
/// seam for model errors, gg's own subprocesses or the turn-boundary probes, and without the notice
/// their absence reads as a claim about the *run* rather than about the recording.
#[test]
fn a_v1_record_reconstructs_behind_the_older_gg_banner() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("replay.json");
    std::fs::write(&path, v1_document()).unwrap();

    let record = read_record(&path).expect("a v1 body upgrades as it is read");
    assert!(record.captured_before_v2());

    let report = ReplayReport {
        program: "tcab gg-replay",
        source: "a v1 record",
        steps: None,
    };
    let out = report_to_string(record, &report).expect("a v1 record reconstructs");

    assert!(
        out.contains("captured by an older gg (format v1)"),
        "the older-gg banner leads the report: {out}",
    );
    assert!(
        out.contains("model errors, gg's own subprocesses, the turn-boundary probes"),
        "and it says which categories are absent from the recording: {out}",
    );
    assert!(
        out.contains("1 model turn(s)") && out.contains("1 tool result(s)"),
        "and it still reconstructed: {out}",
    );
}

/// A current record carries **no** banner: there is nothing to disclaim.
#[test]
fn a_v2_record_carries_no_older_gg_banner() {
    let report = ReplayReport {
        program: "gg replay",
        source: "replay.json",
        steps: None,
    };
    let out = report_to_string(one_turn_record("run-current"), &report).unwrap();
    assert!(!out.contains("older gg"), "{out}");
}

/// The opening line names the program that is speaking and where the record came from — so a
/// delegated reconstruction is distinguishable from a local one at a glance, and a report pasted
/// into an issue says what it is a report *of*.
#[test]
fn the_report_names_the_program_the_session_and_the_source() {
    let report = ReplayReport {
        program: "tcab gg-replay",
        source: "run `run-abc`",
        steps: None,
    };
    let out = report_to_string(one_turn_record("run-abc"), &report).unwrap();
    assert!(
        out.starts_with("tcab gg-replay: reconstructing session `run-abc` from run `run-abc` (1 recorded input(s))"),
        "{out}",
    );
}

/// The record's `recorder` block is reported when it has one — it is explanatory only, never a
/// gate, but it is exactly what tells a developer which `--gg <VERSION>` to reach for when a record
/// will not reconstruct here.
#[test]
fn the_recorder_version_is_reported_when_the_record_names_one() {
    let mut record = one_turn_record("run-stamped");
    record.recorder.gg_version = Some("0.6.9".to_string());
    let report = ReplayReport {
        program: "gg replay",
        source: "replay.json",
        steps: None,
    };
    let out = report_to_string(record, &report).unwrap();
    assert!(out.contains("recorded by gg 0.6.9"), "{out}");
}

/// A record the driver cannot walk is an **error**, not a summary of a partial walk. A
/// reconstruction that quietly reported fewer steps than the run had would be worse than no
/// reconstruction at all, because it looks complete.
#[test]
fn a_record_that_does_not_reconstruct_is_an_error() {
    let mut record = one_turn_record("run-gap");
    // Give the turn a tool call the record pins no outcome for — a truncated capture.
    let call = ToolCall {
        id: "c1".to_string(),
        name: "write_file".to_string(),
        arguments: json!({ "path": "a.txt" }),
    };
    let response = ModelResponse {
        text: Some("writing".to_string()),
        tool_calls: vec![call],
        finish_reason: FinishReason::ToolCalls,
        usage: TokenCounts::default(),
        cost: None,
        loop_aborts: 0,
    };
    if let GgReplayEntryKind::ModelIo {
        response: recorded, ..
    } = &mut record.entries[0].kind
    {
        *recorded = serde_json::to_value(&response).unwrap();
    }

    let report = ReplayReport {
        program: "gg replay",
        source: "replay.json",
        steps: None,
    };
    let err = report_to_string(record, &report).expect_err("an incomplete record is reported");
    assert!(err.to_string().contains("does not reconstruct"), "{err:#}",);
}

/// `--steps` writes the per-agent step-through as JSON, and the report says where it went.
#[test]
fn the_step_through_is_written_when_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let steps = dir.path().join("steps.json");
    let report = ReplayReport {
        program: "gg replay",
        source: "replay.json",
        steps: Some(&steps),
    };
    let out = report_to_string(one_turn_record("run-steps"), &report).unwrap();

    assert!(out.contains("step-through written to"), "{out}");
    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&steps).unwrap()).unwrap();
    assert_eq!(
        written[0]["saw"]["messages"][0]["content"], "build the page",
        "the step-through carries message bodies, not pool indices: {written}",
    );
}

/// An unreadable path fails with the path in the message, rather than with a bare io error.
#[test]
fn a_missing_record_file_names_itself() {
    let err = read_record(std::path::Path::new("/nonexistent/replay.json")).unwrap_err();
    assert!(
        format!("{err:#}").contains("/nonexistent/replay.json"),
        "{err:#}",
    );
}
