//! The `read_file` [read modes](super::ReadPolicy): resolution from a capability's
//! implementation/params, and what each mode actually returns.

use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext};

/// A temp workspace holding `lines.txt`, a file of `count` numbered lines
/// (`line 1`…`line {count}`), and a context rooted at it.
fn workspace_with_lines(count: usize) -> (TempDir, ToolContext) {
    let dir = TempDir::new().unwrap();
    let body: String = (1..=count).map(|n| format!("line {n}\n")).collect();
    std::fs::write(dir.path().join("lines.txt"), body).unwrap();
    let ctx = ToolContext::new(dir.path());
    (dir, ctx)
}

/// The tool under `policy`.
fn tool(policy: ReadPolicy) -> ReadFileTool {
    ReadFileTool::new(policy)
}

// ---------------------------------------------------------------------------
// Resolving the policy from a capability config
// ---------------------------------------------------------------------------

#[test]
fn resolve_defaults_to_unlimited() {
    // No implementation at all — the historical behavior.
    assert_eq!(
        ReadPolicy::resolve(None, &json!({})),
        ReadPolicy::Unlimited,
        "an unconfigured read-file capability reads whole files"
    );
    assert_eq!(
        ReadPolicy::resolve(Some(READ_MODE_UNLIMITED), &json!({ "lineCap": 10 })),
        ReadPolicy::Unlimited,
        "the unlimited mode ignores a line cap"
    );
}

#[test]
fn resolve_reads_the_line_cap_for_each_capped_mode() {
    assert_eq!(
        ReadPolicy::resolve(Some(READ_MODE_HARD_CAP), &json!({ "lineCap": 120 })),
        ReadPolicy::HardCap(120)
    );
    assert_eq!(
        ReadPolicy::resolve(Some(READ_MODE_DEFAULT_CAP), &json!({ "lineCap": 120 })),
        ReadPolicy::DefaultCap(120)
    );
}

#[test]
fn resolve_falls_back_to_the_default_cap_when_the_param_is_missing_or_absurd() {
    for params in [
        json!({}),
        json!({ "lineCap": 0 }),
        json!({ "lineCap": "250" }),
    ] {
        assert_eq!(
            ReadPolicy::resolve(Some(READ_MODE_HARD_CAP), &params),
            ReadPolicy::HardCap(DEFAULT_READ_LINE_CAP),
            "params {params} should fall back to the default cap"
        );
    }
}

#[test]
fn resolve_treats_an_unknown_mode_as_unlimited() {
    // A typo'd arm must not silently enforce a cap nobody configured.
    assert_eq!(
        ReadPolicy::resolve(Some("hardcap"), &json!({ "lineCap": 10 })),
        ReadPolicy::Unlimited
    );
}

// ---------------------------------------------------------------------------
// Unlimited (the control arm)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn unlimited_returns_the_whole_file_and_offers_no_paging_arguments() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.starts_with("line 1\n"));
    assert!(read.output.ends_with("line 1000\n"));
    assert!(
        !read.output.contains("showing lines"),
        "an uncapped read has nothing to say about a window"
    );

    let schema = tool(ReadPolicy::Unlimited).definition().parameters;
    let properties = schema["properties"].as_object().unwrap();
    assert!(properties.contains_key("path"));
    assert_eq!(
        properties.len(),
        1,
        "no offset/limit knobs when there is nothing to page"
    );
}

// ---------------------------------------------------------------------------
// Hard cap
// ---------------------------------------------------------------------------

#[tokio::test]
async fn hard_cap_returns_at_most_the_cap_and_says_where_to_continue() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.starts_with("line 1\n"));
    assert!(read.output.contains("line 250\n"));
    assert!(!read.output.contains("line 251\n"));
    assert!(read.output.contains("[showing lines 1-250 of 1000"));
    assert!(read.output.contains("continue with offset: 251"));
    assert_eq!(
        read.summary.as_deref(),
        Some("read lines 1-250 of 1000 (2142 bytes)")
    );
}

#[tokio::test]
async fn hard_cap_reduces_a_larger_limit_and_says_so() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 900 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(!read.output.contains("line 251\n"), "the cap is a ceiling");
    assert!(
        read.output
            .contains("`limit` was reduced to this run's 250-line cap"),
        "the agent is told the ceiling is not negotiable: {}",
        read.output
    );
}

#[tokio::test]
async fn hard_cap_honors_a_smaller_limit() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 3 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert_eq!(
        read.output.lines().take(3).collect::<Vec<_>>(),
        ["line 1", "line 2", "line 3"]
    );
    assert!(read.output.contains("[showing lines 1-3 of 1000"));
    assert!(!read.output.contains("was reduced"));
}

#[tokio::test]
async fn offset_pages_through_a_file() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "lines.txt", "offset": 251 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.starts_with("line 251\n"));
    assert!(read.output.contains("line 500\n"));
    assert!(!read.output.contains("line 501\n"));
    assert!(read.output.contains("[showing lines 251-500 of 1000"));
    assert!(read.output.contains("continue with offset: 501"));
}

#[tokio::test]
async fn the_last_page_does_not_offer_a_continuation() {
    let (_dir, ctx) = workspace_with_lines(300);

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "lines.txt", "offset": 251 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("line 300\n"));
    assert!(read.output.contains("[showing lines 251-300 of 300]"));
    assert!(!read.output.contains("continue with offset"));
}

#[tokio::test]
async fn an_offset_past_the_end_is_an_error_naming_the_length() {
    let (_dir, ctx) = workspace_with_lines(10);

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "lines.txt", "offset": 11 }), &ctx)
        .await;
    assert!(!read.ok);
    assert!(
        read.output.contains("past the end of the file (10 lines)"),
        "{}",
        read.output
    );
}

#[tokio::test]
async fn a_file_shorter_than_the_cap_reads_identically_in_every_mode() {
    let (_dir, ctx) = workspace_with_lines(5);

    let whole = tool(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;
    for policy in [ReadPolicy::HardCap(250), ReadPolicy::DefaultCap(250)] {
        let read = tool(policy)
            .invoke(json!({ "path": "lines.txt" }), &ctx)
            .await;
        assert!(read.ok, "{}", read.output);
        assert_eq!(
            read.output, whole.output,
            "{policy:?} should add no window note to a file that fits"
        );
    }
}

#[tokio::test]
async fn a_non_positive_paging_argument_is_rejected_rather_than_defaulted() {
    let (_dir, ctx) = workspace_with_lines(10);

    for args in [
        json!({ "path": "lines.txt", "offset": 0 }),
        json!({ "path": "lines.txt", "limit": 0 }),
        json!({ "path": "lines.txt", "limit": "5" }),
    ] {
        let read = tool(ReadPolicy::HardCap(250))
            .invoke(args.clone(), &ctx)
            .await;
        assert!(!read.ok, "{args} should be rejected");
        assert!(read.output.contains("must be a positive integer"));
    }
}

// ---------------------------------------------------------------------------
// Default cap
// ---------------------------------------------------------------------------

#[tokio::test]
async fn default_cap_applies_when_no_limit_is_given() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(!read.output.contains("line 251\n"));
    assert!(read.output.contains("[showing lines 1-250 of 1000"));
}

#[tokio::test]
async fn default_cap_honors_a_larger_limit() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 900 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(
        read.output.contains("line 900\n"),
        "the default is a nudge, not a ceiling"
    );
    assert!(!read.output.contains("was reduced"));
    assert!(read.output.contains("[showing lines 1-900 of 1000"));
}

#[tokio::test]
async fn default_cap_reading_past_the_end_stops_at_the_end() {
    let (_dir, ctx) = workspace_with_lines(10);

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 10_000 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(
        read.output.ends_with("line 10\n"),
        "no window note: {}",
        read.output
    );
}

// ---------------------------------------------------------------------------
// The tool declaration the model sees
// ---------------------------------------------------------------------------

#[test]
fn a_capped_mode_declares_its_paging_arguments_and_its_ceiling() {
    let hard = tool(ReadPolicy::HardCap(250)).definition();
    assert!(
        hard.description.contains("at most 250 lines"),
        "{}",
        hard.description
    );
    let properties = hard.parameters["properties"].as_object().unwrap();
    assert!(properties.contains_key("offset"));
    let limit = properties["limit"]["description"].as_str().unwrap();
    assert!(limit.contains("maximum 250"), "{limit}");

    let soft = tool(ReadPolicy::DefaultCap(250)).definition();
    assert!(
        soft.description.contains("250 lines by default"),
        "{}",
        soft.description
    );
    let limit = soft.parameters["properties"]["limit"]["description"]
        .as_str()
        .unwrap();
    assert!(limit.contains("larger is allowed"), "{limit}");
}

// ---------------------------------------------------------------------------
// The byte backstop still applies inside a window
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_byte_ceiling_still_bounds_a_windowed_read() {
    let dir = TempDir::new().unwrap();
    // Two lines, each comfortably over the byte ceiling on its own.
    let huge = "x".repeat(READ_FILE_CAP * 2);
    std::fs::write(dir.path().join("huge.txt"), format!("{huge}\n{huge}\n")).unwrap();
    let ctx = ToolContext::new(dir.path());

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "huge.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("[truncated: showing"));
    assert!(
        read.output.len() < READ_FILE_CAP + 256,
        "a windowed read is still bounded in bytes"
    );
}

/// Multi-byte characters must not be split by the byte ceiling (which would panic).
#[tokio::test]
async fn the_byte_ceiling_respects_character_boundaries() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("wide.txt"), "é".repeat(READ_FILE_CAP)).unwrap();
    let ctx = ToolContext::new(dir.path());

    let read = tool(ReadPolicy::HardCap(250))
        .invoke(json!({ "path": "wide.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("[truncated: showing"));
}
