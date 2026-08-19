//! The `read_file` [read modes](super::ReadPolicy): resolution from a capability's
//! implementation/params, and what each mode actually returns.

use super::*;
use serde_json::json;
use tempfile::TempDir;

use crate::tools::{Tool, ToolContext};
use crate::validate::{LaunchDefect, LaunchReport};

/// The policy `implementation`/`params` resolve to, asserting gg honoured them exactly as written.
fn policy(implementation: Option<&str>, params: &serde_json::Value) -> ReadPolicy {
    let mut report = LaunchReport::collecting();
    let policy = ReadPolicy::resolve(implementation, params, &mut report);
    let defects = report.into_defects();
    assert!(defects.is_empty(), "unexpected refusals: {defects:?}");
    policy
}

/// Everything resolving `implementation`/`params` reports, for the cases whose subject is the
/// refusal.
fn reported(
    implementation: Option<&str>,
    params: &serde_json::Value,
) -> (ReadPolicy, Vec<LaunchDefect>) {
    let mut report = LaunchReport::collecting();
    let policy = ReadPolicy::resolve(implementation, params, &mut report);
    (policy, report.into_defects())
}

/// The [`FileTextData`] an outcome carries, or a failure naming what it carried instead.
fn text_data(outcome: &ToolOutcome) -> &FileTextData {
    match outcome.data.as_ref() {
        Some(ApiData::FileText(data)) => data,
        other => panic!("expected file text, got {other:?}"),
    }
}

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
        policy(None, &json!({})),
        ReadPolicy::Unlimited,
        "an unconfigured read-file capability reads whole files"
    );
    assert_eq!(
        policy(Some(READ_MODE_UNLIMITED), &json!({ "lineCap": 10 })),
        ReadPolicy::Unlimited,
        "the unlimited mode ignores a line cap"
    );
}

#[test]
fn resolve_reads_the_line_cap_for_the_capped_mode() {
    assert_eq!(
        policy(Some(READ_MODE_DEFAULT_CAP), &json!({ "lineCap": 120 })),
        ReadPolicy::DefaultCap(120)
    );
    // JSON has no integer type, so an integral float names the same count.
    assert_eq!(
        policy(Some(READ_MODE_DEFAULT_CAP), &json!({ "lineCap": 120.0 })),
        ReadPolicy::DefaultCap(120)
    );
}

/// An **absent** cap is the documented default, and that is not a fallback: a capped mode with
/// nothing to say about its ceiling gets gg's.
#[test]
fn an_absent_line_cap_takes_the_default() {
    for params in [json!({}), json!({ "lineCap": null })] {
        assert_eq!(
            policy(Some(READ_MODE_DEFAULT_CAP), &params),
            ReadPolicy::DefaultCap(DEFAULT_READ_LINE_CAP),
            "params {params}"
        );
    }
}

/// A `lineCap` gg cannot honour **refuses the launch**: a cap of no lines would make every read
/// return nothing, and reading it as gg's 250 would page the agent at a ceiling nobody wrote.
#[test]
fn an_unusable_line_cap_is_refused() {
    for value in [json!(0), json!("250"), json!(-1), json!(12.5), json!([250])] {
        let params = json!({ "lineCap": value });
        let (resolved, defects) = reported(Some(READ_MODE_DEFAULT_CAP), &params);
        assert_eq!(
            resolved,
            ReadPolicy::DefaultCap(DEFAULT_READ_LINE_CAP),
            "{params}: the resolver stays total"
        );
        assert_eq!(defects.len(), 1, "{params} -> {defects:?}");
        assert_eq!(defects[0].locus, "read-file.params.lineCap", "{params}");
    }
}

/// **A mode gg does not recognize refuses the launch**, and this is the sharpest case of the rule
/// in gg: the implementation is the arm selector, so a typo'd `default_cap` used to hand its agent
/// **unlimited** reads while the run's record named the capped arm — the two arms run as one.
#[test]
fn an_unknown_read_mode_is_refused() {
    for implementation in ["hardcap", "default_cap"] {
        let (resolved, defects) = reported(Some(implementation), &json!({ "lineCap": 10 }));
        assert_eq!(
            resolved,
            ReadPolicy::Unlimited,
            "`{implementation}`: the resolver stays total"
        );
        assert_eq!(defects.len(), 1, "`{implementation}` -> {defects:?}");
        assert_eq!(defects[0].locus, "read-file.implementation");
        assert_eq!(defects[0].known, READ_MODES);
    }
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
// The default cap: the window it applies, and the limit that talks past it
// ---------------------------------------------------------------------------

#[tokio::test]
async fn the_cap_applies_when_no_limit_is_given_and_says_where_to_continue() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
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
async fn a_smaller_limit_is_honored() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 3 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert_eq!(
        read.output.lines().take(3).collect::<Vec<_>>(),
        ["line 1", "line 2", "line 3"]
    );
    assert!(read.output.contains("[showing lines 1-3 of 1000"));
}

#[tokio::test]
async fn a_limit_larger_than_the_cap_is_honored_verbatim() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 900 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(
        read.output.contains("line 900\n"),
        "the cap is a nudge, not a ceiling"
    );
    assert!(
        !read.output.contains("line 901\n"),
        "and not a floor either"
    );
    assert!(read.output.contains("[showing lines 1-900 of 1000"));
    let data = text_data(&read);
    assert_eq!(
        (data.first_line, data.last_line, data.total_lines),
        (1, 900, 1_000),
        "the window the agent asked for, verbatim"
    );
}

/// **The invariant behind dropping the hard cap**: a `limit` large enough to cover the file
/// returns the file, byte for byte, exactly as the unlimited mode would — footer and all
/// (that is, none). No mode gg offers can refuse a whole-file read, because gg has a caller
/// that must be able to make one (autoloaded specifications seed a case's specs whole).
#[tokio::test]
async fn a_large_enough_limit_reads_the_whole_file_exactly_as_the_unlimited_mode_does() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let whole = tool(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;
    let capped = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt", "limit": 1_000 }), &ctx)
        .await;

    assert!(capped.ok, "{}", capped.output);
    assert_eq!(
        capped.output, whole.output,
        "a cap the agent asked past adds nothing — no window note, no reduction note"
    );
    assert_eq!(capped.summary, whole.summary);
    assert!(capped.output.ends_with("line 1000\n"));
}

#[tokio::test]
async fn a_limit_past_the_end_stops_at_the_end() {
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

#[tokio::test]
async fn offset_pages_through_a_file() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
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

    let read = tool(ReadPolicy::DefaultCap(250))
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

    let read = tool(ReadPolicy::DefaultCap(250))
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
    let capped = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;
    assert!(capped.ok, "{}", capped.output);
    assert_eq!(
        capped.output, whole.output,
        "a capped mode should add no window note to a file that fits"
    );
}

#[tokio::test]
async fn a_non_positive_paging_argument_is_rejected_rather_than_defaulted() {
    let (_dir, ctx) = workspace_with_lines(10);

    for args in [
        json!({ "path": "lines.txt", "offset": 0 }),
        json!({ "path": "lines.txt", "limit": 0 }),
        json!({ "path": "lines.txt", "limit": "5" }),
    ] {
        let read = tool(ReadPolicy::DefaultCap(250))
            .invoke(args.clone(), &ctx)
            .await;
        assert!(!read.ok, "{args} should be rejected");
        assert!(read.output.contains("must be a positive integer"));
    }
}

// ---------------------------------------------------------------------------
// The structured sidecar under each mode
// ---------------------------------------------------------------------------

/// The window the footer describes in prose is reported as three numbers, and the contents it
/// describes are footer-free — a caller gets the file's text, not gg's rendering of it.
#[tokio::test]
async fn a_windowed_read_reports_its_window_without_the_footer() {
    let (_dir, ctx) = workspace_with_lines(1_000);

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "lines.txt", "offset": 251 }), &ctx)
        .await;

    let data = text_data(&read);
    assert_eq!(
        (data.first_line, data.last_line, data.total_lines),
        (251, 500, 1_000)
    );
    assert!(data.contents.starts_with("line 251\n"));
    assert!(data.contents.ends_with("line 500\n"));
    assert!(
        !data.contents.contains("showing lines"),
        "the footer belongs to the prose, not to the file: {}",
        data.contents
    );
    assert!(!data.byte_truncated);
}

/// An unlimited read reports the whole file as one window.
#[tokio::test]
async fn an_unlimited_read_reports_the_whole_file_as_the_window() {
    let (_dir, ctx) = workspace_with_lines(12);

    let read = tool(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "lines.txt" }), &ctx)
        .await;

    let data = text_data(&read);
    assert_eq!(
        (data.first_line, data.last_line, data.total_lines),
        (1, 12, 12)
    );
    assert!(!data.byte_truncated);
}

/// The byte ceiling is reported as its own flag, separately from the line window: a single
/// enormous line is cut in bytes even when the whole file was asked for, and the file's real
/// length is still reported.
#[tokio::test]
async fn the_byte_ceiling_is_reported_separately_from_the_window() {
    let dir = TempDir::new().unwrap();
    let huge = "x".repeat(READ_FILE_CAP * 2);
    std::fs::write(dir.path().join("huge.txt"), format!("{huge}\n{huge}\n")).unwrap();
    let ctx = ToolContext::new(dir.path());

    let whole = tool(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "huge.txt" }), &ctx)
        .await;
    let data = text_data(&whole);
    assert!(data.byte_truncated);
    assert_eq!(data.total_lines, 2, "the file's length, not the prefix's");
    assert!(!data.contents.contains("[truncated"));

    let windowed = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "huge.txt" }), &ctx)
        .await;
    let data = text_data(&windowed);
    assert!(data.byte_truncated);
    assert_eq!(
        (data.first_line, data.last_line, data.total_lines),
        (1, 2, 2)
    );
}

/// An empty file is an empty window — reported honestly rather than as one blank line.
#[tokio::test]
async fn an_empty_file_reports_an_empty_window() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("empty.txt"), "").unwrap();
    let ctx = ToolContext::new(dir.path());

    for policy in [ReadPolicy::Unlimited, ReadPolicy::DefaultCap(250)] {
        let read = tool(policy)
            .invoke(json!({ "path": "empty.txt" }), &ctx)
            .await;
        let data = text_data(&read);
        assert_eq!(
            (data.first_line, data.last_line, data.total_lines),
            (1, 0, 0),
            "{policy:?} should report an empty window"
        );
        assert!(data.contents.is_empty());
    }
}

/// A file whose last line has no trailing newline still counts as ending on that line.
#[tokio::test]
async fn an_unterminated_last_line_is_counted() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("f.txt"), "one\ntwo").unwrap();
    let ctx = ToolContext::new(dir.path());

    let read = tool(ReadPolicy::Unlimited)
        .invoke(json!({ "path": "f.txt" }), &ctx)
        .await;
    assert_eq!(text_data(&read).total_lines, 2);
}

// ---------------------------------------------------------------------------
// The tool declaration the model sees
// ---------------------------------------------------------------------------

/// Two modes, two declarations: the capped one offers the paging arguments and states the
/// default *as* a default, and the unlimited one offers neither knob.
///
/// The cap is stated on `limit` — the argument that overrides it — and nowhere else: the
/// system prompt already tells the model how many lines a read returns this run, so repeating
/// it in the tool's own prose is a second copy sent on every request.
#[test]
fn each_mode_declares_exactly_the_arguments_it_honors() {
    let capped = tool(ReadPolicy::DefaultCap(250)).definition();
    let properties = capped.parameters["properties"].as_object().unwrap();
    assert!(properties.contains_key("offset"));
    let limit = properties["limit"]["description"].as_str().unwrap();
    assert!(
        limit.contains("250") && limit.contains("larger is allowed"),
        "the declaration states the cap as a default the model may talk past: {limit}"
    );
    assert!(
        !capped.description.contains("250"),
        "the system prompt already states this run's line cap: {}",
        capped.description
    );

    let unlimited = tool(ReadPolicy::Unlimited).definition();
    let properties = unlimited.parameters["properties"].as_object().unwrap();
    assert!(!properties.contains_key("offset"));
    assert!(
        !properties.contains_key("limit"),
        "there is nothing to page through"
    );
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

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "huge.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("[truncated: showing"));
    assert!(
        read.output.len() < READ_FILE_CAP + 256,
        "a windowed read is still bounded in bytes"
    );
}

/// The byte ceiling is a separate limit from the line window, and an honoured larger `limit`
/// does not buy past it: asking for the whole of a file made of enormous lines still returns
/// at most [`READ_FILE_CAP`] bytes, and says so.
#[tokio::test]
async fn the_byte_ceiling_bounds_even_an_honored_larger_limit() {
    let dir = TempDir::new().unwrap();
    let huge = "x".repeat(READ_FILE_CAP);
    std::fs::write(dir.path().join("huge.txt"), format!("{huge}\n{huge}\n")).unwrap();
    let ctx = ToolContext::new(dir.path());

    let read = tool(ReadPolicy::DefaultCap(1))
        .invoke(json!({ "path": "huge.txt", "limit": 2 }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    let data = text_data(&read);
    assert!(data.byte_truncated);
    assert_eq!(data.contents.len(), READ_FILE_CAP);
    assert_eq!(
        (data.first_line, data.last_line, data.total_lines),
        (1, 2, 2),
        "the window was honoured in lines; only the bytes were cut"
    );
}

/// A read that is both windowed **and** byte-truncated states both facts, in that order: the byte
/// note (which describes what was cut) before the window note (which describes where to continue).
///
/// This is the one combination the other tests do not reach, and it is where the model-facing text
/// is assembled from the most pieces — so it is pinned exactly rather than by substring.
#[tokio::test]
async fn a_windowed_read_that_is_also_byte_truncated_states_both() {
    let dir = TempDir::new().unwrap();
    let huge = "x".repeat(READ_FILE_CAP);
    std::fs::write(
        dir.path().join("huge.txt"),
        format!("{huge}\n{huge}\n{huge}\n"),
    )
    .unwrap();
    let ctx = ToolContext::new(dir.path());

    let read = tool(ReadPolicy::DefaultCap(2))
        .invoke(json!({ "path": "huge.txt" }), &ctx)
        .await;

    assert!(read.ok, "{}", read.output);
    let body = "x".repeat(READ_FILE_CAP);
    assert_eq!(
        read.output,
        format!(
            "{body}\n\n[truncated: showing {READ_FILE_CAP} of {} bytes]\
             \n\n[showing lines 1-2 of 3; continue with offset: 3]",
            READ_FILE_CAP * 2 + 2
        )
    );

    let data = text_data(&read);
    assert!(data.byte_truncated);
    assert_eq!(
        (data.first_line, data.last_line, data.total_lines),
        (1, 2, 3)
    );
    assert_eq!(data.contents, body, "the sidecar carries neither footer");
}

/// Multi-byte characters must not be split by the byte ceiling (which would panic).
#[tokio::test]
async fn the_byte_ceiling_respects_character_boundaries() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join("wide.txt"), "é".repeat(READ_FILE_CAP)).unwrap();
    let ctx = ToolContext::new(dir.path());

    let read = tool(ReadPolicy::DefaultCap(250))
        .invoke(json!({ "path": "wide.txt" }), &ctx)
        .await;
    assert!(read.ok, "{}", read.output);
    assert!(read.output.contains("[truncated: showing"));
}
