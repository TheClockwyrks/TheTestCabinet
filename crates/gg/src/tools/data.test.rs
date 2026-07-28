//! Tests for the structured sidecar's own contract: the shapes serialise, every variant survives
//! a round trip through the wire format the replay recorder writes, and the classifications that
//! are derived rather than hand-written are derived correctly.
//!
//! The per-tool assertions ("does `list_dir` actually emit its entries?") live with the tools, in
//! each module's own `.test.rs`. What is covered here is the vocabulary itself, which every one of
//! those depends on.

use serde_json::json;

use super::*;

/// Every payload, once, so that a variant added without a serde representation that works cannot
/// slip through — the two-line list below is the thing a new variant has to be added to.
fn one_of_each() -> Vec<ToolData> {
    vec![
        ToolData::Shell(ShellData {
            exit_code: Some(0),
            body: "ok\n".to_string(),
            truncated: false,
        }),
        ToolData::FileText(FileTextData {
            contents: "line 1\n".to_string(),
            first_line: 1,
            last_line: 1,
            total_lines: 9,
            byte_truncated: false,
            limit_reduced: true,
        }),
        ToolData::FileImage(FileImageData {
            media_type: "image/png".to_string(),
            label: "PNG".to_string(),
            bytes: 33,
            shown: true,
            not_shown_reason: None,
        }),
        ToolData::BytesWritten(1_024),
        ToolData::DirEntries(vec![DirEntryData {
            name: "src".to_string(),
            kind: DirEntryKind::Directory,
        }]),
        ToolData::MemoryUsage(MemoryUsageData {
            count: 1,
            max_count: Some(8),
            total_chars: 20,
            max_total_chars: Some(4_000),
            index_chars: None,
            max_index_chars: None,
        }),
        ToolData::MemoryHits(vec![MemoryHitData {
            name: "layout".to_string(),
            description: "where things live".to_string(),
            matched: 2,
            occurrences: 3,
            excerpt: "…src/ holds the engine…".to_string(),
        }]),
        ToolData::TaskUsage(UsagePair { count: 2, max: 40 }),
        ToolData::BoardUsage(BoardUsageData {
            epics: 1,
            max_epics: 10,
            issues: 3,
            max_issues: 60,
        }),
        ToolData::Completion(CompletionData {
            code_reviewed: true,
            detail: "approved".to_string(),
        }),
        ToolData::Reclaim(ReclaimData {
            items: 4,
            reclaimed_tokens: 900,
            paths: vec!["src/a.ts".to_string()],
            detail: "evicted 4 file views".to_string(),
        }),
        ToolData::ArchiveSearch(ArchiveSearchData {
            archive_empty: false,
            hits: vec![ArchiveHitData {
                seq: 7,
                role: Role::Assistant,
                text: "physics tuning".to_string(),
            }],
        }),
        ToolData::SubagentSpawned(SubagentHandleData {
            id: "agent-1".to_string(),
            slot: "primary".to_string(),
            model_id: "vendor/model".to_string(),
            worktree_branch: Some("gg/agent-1".to_string()),
        }),
        ToolData::SubagentResults(vec![SubagentResultData {
            id: "agent-1".to_string(),
            status: Some(AgentStatusData::Completed),
            summary: "done".to_string(),
        }]),
        ToolData::Workflow(WorkflowData {
            workflow_id: "wf-1".to_string(),
            stages: 2,
            results: vec!["a".to_string(), "b".to_string()],
        }),
        ToolData::Speculation(SpeculationData {
            winner_id: "agent-3".to_string(),
            attempts: 3,
            rationale: Some("cleanest diff".to_string()),
            summary: "merged agent-3".to_string(),
        }),
    ]
}

/// Every variant survives a JSON round trip. The replay recorder captures the whole outcome
/// verbatim and a replay driver feeds it back, so a payload that cannot make that trip is a
/// payload that silently disappears from a replayed session.
#[test]
fn every_payload_round_trips_through_json() {
    for data in one_of_each() {
        let json = serde_json::to_string(&data)
            .unwrap_or_else(|err| panic!("{data:?} should serialise: {err}"));
        let back: ToolData = serde_json::from_str(&json)
            .unwrap_or_else(|err| panic!("{json} should deserialise: {err}"));
        assert_eq!(back, data, "round trip changed {data:?}");
    }
}

/// The representation is adjacently tagged, in camelCase, with the payload under `data`.
///
/// This is the guard for the two variants that wrap something which is not a map: serde's
/// *internally* tagged representation cannot serialise a newtype around a number or a list at all,
/// and fails at run time rather than at compile time — which is to say, in a container, on a
/// tool call, weeks later.
#[test]
fn the_wire_shape_is_adjacently_tagged() {
    assert_eq!(
        serde_json::to_value(ToolData::BytesWritten(12)).unwrap(),
        json!({ "kind": "bytesWritten", "data": 12 })
    );
    assert_eq!(
        serde_json::to_value(ToolData::DirEntries(vec![DirEntryData {
            name: "a.ts".to_string(),
            kind: DirEntryKind::File,
        }]))
        .unwrap(),
        json!({ "kind": "dirEntries", "data": [{ "name": "a.ts", "kind": "file" }] })
    );
    assert_eq!(
        serde_json::to_value(ToolData::TaskUsage(UsagePair { count: 1, max: 4 })).unwrap(),
        json!({ "kind": "taskUsage", "data": { "count": 1, "max": 4 } })
    );
}

/// Payload fields are camelCase, matching the outcome that carries them.
#[test]
fn payload_fields_are_camel_case() {
    let shell = serde_json::to_value(ToolData::Shell(ShellData {
        exit_code: Some(3),
        body: "boom".to_string(),
        truncated: true,
    }))
    .unwrap();
    assert_eq!(shell["data"]["exitCode"], json!(3));
    assert_eq!(shell["data"]["truncated"], json!(true));

    let read = serde_json::to_value(ToolData::FileText(FileTextData {
        contents: "x".to_string(),
        first_line: 251,
        last_line: 500,
        total_lines: 1_000,
        byte_truncated: false,
        limit_reduced: true,
    }))
    .unwrap();
    assert_eq!(read["data"]["firstLine"], json!(251));
    assert_eq!(read["data"]["lastLine"], json!(500));
    assert_eq!(read["data"]["totalLines"], json!(1_000));
    assert_eq!(read["data"]["byteTruncated"], json!(false));
    assert_eq!(read["data"]["limitReduced"], json!(true));
}

/// A signal-terminated process has no exit code, and that is representable — the reason
/// `exit_code` is an option rather than a sentinel.
#[test]
fn a_signal_terminated_process_has_no_exit_code() {
    let value = serde_json::to_value(ToolData::Shell(ShellData {
        exit_code: None,
        body: String::new(),
        truncated: false,
    }))
    .unwrap();
    assert_eq!(value["data"]["exitCode"], json!(null));
}

/// The failure classes serialise in the kebab-case spelling a structured caller reads them in.
#[test]
fn failures_serialise_in_kebab_case() {
    for (failure, spelling) in [
        (ToolFailure::InvalidArgument, "invalid-argument"),
        (ToolFailure::NotFound, "not-found"),
        (ToolFailure::Conflict, "conflict"),
        (ToolFailure::Refused, "refused"),
        (ToolFailure::Unavailable, "unavailable"),
        (ToolFailure::LimitExceeded, "limit-exceeded"),
        (ToolFailure::IoError, "io-error"),
    ] {
        assert_eq!(serde_json::to_value(failure).unwrap(), json!(spelling));
        assert_eq!(
            serde_json::from_value::<ToolFailure>(json!(spelling)).unwrap(),
            failure
        );
    }
}

/// A missing path is classified `not-found`; every other I/O failure is `io-error`. The split is
/// made on the error's kind, never on its rendered text.
#[test]
fn io_errors_are_classified_by_kind() {
    use std::io::{Error, ErrorKind};

    assert_eq!(
        ToolFailure::from_io(&Error::new(ErrorKind::NotFound, "no such file")),
        ToolFailure::NotFound
    );
    for kind in [
        ErrorKind::PermissionDenied,
        ErrorKind::IsADirectory,
        ErrorKind::StorageFull,
        ErrorKind::InvalidData,
    ] {
        assert_eq!(
            ToolFailure::from_io(&Error::new(kind, "nope")),
            ToolFailure::IoError,
            "{kind:?} is not a missing path"
        );
    }
}

/// gg's recorded status vocabulary maps onto the typed statuses, and anything else — including the
/// empty string a child that returned nothing leaves — is "no status" rather than a guess.
#[test]
fn an_agent_status_is_parsed_from_ggs_own_vocabulary() {
    assert_eq!(
        AgentStatusData::parse("completed"),
        Some(AgentStatusData::Completed)
    );
    assert_eq!(
        AgentStatusData::parse("exhausted"),
        Some(AgentStatusData::Exhausted)
    );
    assert_eq!(
        AgentStatusData::parse("timed_out"),
        Some(AgentStatusData::TimedOut)
    );
    assert_eq!(
        AgentStatusData::parse("model_error"),
        Some(AgentStatusData::ModelError)
    );
    assert_eq!(
        AgentStatusData::parse("auth_error"),
        Some(AgentStatusData::AuthError)
    );

    assert_eq!(AgentStatusData::parse(""), None);
    assert_eq!(AgentStatusData::parse("Completed"), None);
    assert_eq!(AgentStatusData::parse("timed-out"), None);
}

/// A count that does not fit saturates instead of wrapping into a small, plausible, wrong number.
#[test]
fn an_oversized_count_saturates() {
    assert_eq!(saturating_u32(0), 0);
    assert_eq!(saturating_u32(42), 42);
    assert_eq!(saturating_u32(u32::MAX as usize), u32::MAX);
    assert_eq!(saturating_u32(u32::MAX as usize + 1), u32::MAX);
    assert_eq!(saturating_u32(usize::MAX), u32::MAX);
}
