//! Tests for the view family — the four calls a program puts material into its own context window
//! with, three of which are not tool calls at all.

use std::time::{Duration, Instant};

use super::super::ErrorCode;
use super::super::capture::MAX_RECORDED_VIEW_EVENTS;
use super::*;
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome, membrane, membrane_with};
use crate::tools::{FileTextData, ToolData, ToolFailure, ToolOutcome};

/// **`open-file-view` is a `read_file`, and is rostered as one.**
///
/// The whole reason it goes through `dispatch` rather than straight to the api: a program that
/// shows itself a file has made a read, and the run's roster, telemetry, replay record and
/// capability backstop must all see it as one. If this ever stopped being true, a run could read a
/// file through a side door that no capability governs.
#[test]
fn opening_a_file_view_dispatches_a_read_file() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let read = state
        .open_file_view("src/a.ts".to_string(), None, None)
        .expect("the file is read and shown");

    match read {
        FileRead::Text(text) => assert!(text.contents.contains("contents of src/a.ts")),
        FileRead::Image(_) => panic!("a .ts file is text"),
    }
    assert_eq!(
        log.names(),
        ["read_file"],
        "it is a read, under its own name"
    );

    let parts = state.into_parts();
    assert_eq!(
        parts.calls.len(),
        1,
        "and it takes an ordinary roster entry, not a special one"
    );
    assert_eq!(parts.calls[0].name, "read_file");
    let opened = &parts.views_opened;
    assert_eq!(opened.len(), 1);
    assert_eq!(opened[0].selector, "src/a.ts");
    assert_eq!(opened[0].kind, HostViewKind::File);
    assert!(!opened[0].superseded, "nothing was open under that path");
}

/// **The window a paged view covers comes back to the program.**
///
/// `current-views` is what `view.current()` renders, and a paged file view is only distinguishable
/// from a whole-file one by its region — which is also what makes two pages of one file two views
/// rather than one changing its mind.
#[test]
fn a_paged_file_view_reports_its_region() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_name, args| {
        let path = args["path"].as_str().unwrap_or_default().to_string();
        ToolOutcome::ok(format!("page of {path}"), "read 2 lines").with_data(ToolData::FileText(
            FileTextData {
                contents: format!("page of {path}"),
                first_line: 201,
                last_line: 400,
                total_lines: 1_000,
                byte_truncated: false,
                limit_reduced: false,
            },
        ))
    });

    state
        .open_file_view("src/a.ts".to_string(), Some(201), Some(200))
        .expect("the page is read and shown");

    let views = state.current_views();
    assert_eq!(views.len(), 1);
    assert_eq!(views[0].kind, ViewKind::File);
    let region = views[0].region.expect("a paged view carries its window");
    assert_eq!(
        (region.offset, region.limit),
        (201, 200),
        "the region is what the read RETURNED, which is what re-opening the page must cover"
    );
}

/// **A read that failed opens nothing, and says so twice.**
///
/// The program is thrown into (it asked for a file it cannot have), and the turn's view report
/// carries the refusal — because "the material you asked to be shown is not in your window" is a
/// fact the model has to be told in the turn it happened.
#[test]
fn a_failed_read_opens_no_view_and_is_reported_as_a_refusal() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_name, _args| {
        ToolOutcome::failed(ToolFailure::NotFound, "no such file `nope.ts`")
    });

    let error = state
        .open_file_view("nope.ts".to_string(), None, None)
        .expect_err("the read failed, so nothing is shown");
    assert_eq!(error.code, ErrorCode::NotFound);

    let parts = state.into_parts();
    assert!(parts.views_opened.is_empty());
    assert_eq!(parts.view_refusals.len(), 1);
    assert!(parts.view_refusals[0].contains("nope.ts"));
}

/// **A view of a picture puts the picture in the WINDOW, not on the turn's feedback.**
///
/// This is the arrangement the feature replaces: a program's `readFile` of a mockup used to ride out
/// on the turn's attachments, unattributable and gone the next turn. As a view it is one item, keyed
/// by its path, evictable by it, and charged to the file-view band — so it must not *also* be
/// attached to the feedback, or the same picture is paid for twice.
#[test]
fn a_viewed_picture_does_not_ride_out_on_the_turns_attachments() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let read = state
        .open_file_view("mock.png".to_string(), None, None)
        .expect("the picture is read and shown");
    match read {
        FileRead::Image(image) => assert_eq!(image.media_type, "image/png"),
        FileRead::Text(_) => panic!("a .png is a picture"),
    }

    let parts = state.into_parts();
    assert!(
        parts.images.is_empty(),
        "the picture belongs to the view item now"
    );
    assert_eq!(parts.views_opened.len(), 1);
}

/// **Re-opening a selector replaces it, and the report says which happened.**
///
/// "Opened" and "replaced" are different facts. A program that recomputes a summary in a loop must
/// read its own accounting as one view re-stated, not as N views accumulating — which is exactly
/// what would make this feature worse than the anonymous blob it replaces.
#[test]
fn re_opening_a_selector_is_reported_as_a_supersede() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .open_text_view("summary".to_string(), "first".to_string())
        .expect("opened");
    state
        .open_text_view("summary".to_string(), "second".to_string())
        .expect("replaced");

    assert_eq!(state.current_views().len(), 1, "one view, re-stated");

    let opened = state.into_parts().views_opened;
    assert_eq!(opened.len(), 2, "but two calls, both reported");
    assert!(!opened[0].superseded);
    assert!(opened[1].superseded);
}

/// **A text view is not a tool call.**
///
/// No dispatch, so no roster entry, no `ToolCall`/`ToolResult` pair and no replay record — a program
/// that opens ten views has still made zero tool calls. Counting them as calls would make the
/// `CodeExecution` event's `tool_calls` disagree with the number of telemetry pairs the turn
/// actually streamed.
#[test]
fn text_views_are_not_dispatched_as_tool_calls() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .open_text_view("notes".to_string(), "a computed table".to_string())
        .expect("opened");
    state.close_view("notes".to_string()).expect("closed");

    assert!(log.names().is_empty(), "nothing was dispatched");
    let parts = state.into_parts();
    assert!(parts.calls.is_empty());
    assert!(parts.refusals.is_empty());
    assert_eq!(parts.views_closed, ["notes"]);
}

/// **Closing a selector that is not open is `0`, not a failure.**
///
/// A program that tidies up unconditionally should not have to guard every call with a `current()`
/// check — and a close that reclaimed nothing must not be reported as one that did, or the model
/// reads its window as smaller than it is.
#[test]
fn closing_nothing_succeeds_and_reports_nothing() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    assert_eq!(state.close_view("never-opened".to_string()).expect("ok"), 0);

    let parts = state.into_parts();
    assert!(parts.views_closed.is_empty());
    assert!(parts.view_refusals.is_empty(), "it did not fail");
}

/// **An unusable selector is `invalid-argument`, and is reported as a refusal.**
///
/// A view with no selector could never be closed, replaced or attributed, so the membrane refuses to
/// represent one rather than opening something the model can never act on.
#[test]
fn an_empty_label_is_an_argument_error() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let error = state
        .open_text_view("   ".to_string(), "body".to_string())
        .expect_err("a blank label names nothing");
    assert_eq!(error.code, ErrorCode::InvalidArgument);
    assert_eq!(error.tool, "openText", "it names the function it called");

    let parts = state.into_parts();
    assert_eq!(parts.view_refusals.len(), 1);
    assert!(
        parts.refusals.is_empty(),
        "a refused view is not a refused TOOL: nothing was withheld and nothing was dispatched"
    );
}

/// **A spent wall-clock budget never withholds a view.**
///
/// The same carve-out `finish` has, and for the same reason: showing yourself what you already
/// computed performs no work, and a turn that cannot report what it found is worse than one that
/// reports late. `open-file-view` is the exception — it really does read a file — and is refused
/// like any other read.
#[test]
fn a_spent_budget_refuses_the_read_but_not_the_report() {
    let log = CallLog::default();
    let spent = Instant::now() - Duration::from_secs(1);
    let mut state = membrane_with(&log, &all_tools(), Some(spent), canned_outcome);

    state
        .open_text_view(
            "what I found".to_string(),
            "the build fails in x.ts".to_string(),
        )
        .expect("a report is never withheld");
    state
        .current_views()
        .first()
        .expect("and it is in the window");

    let error = state
        .open_file_view("src/a.ts".to_string(), None, None)
        .expect_err("but a read is a read");
    assert_eq!(error.code, ErrorCode::LimitExceeded);
}

/// **A run that withholds `read_file` does not get one through `view.openFile`.**
///
/// The enabled-set backstop is why this one call goes through `dispatch` at all. The guest does not
/// bind `openFile` in such a run, so a program cannot normally reach this — which makes it exactly
/// the defensive check that must not be skipped.
#[test]
fn a_run_without_read_file_cannot_open_a_file_view() {
    let log = CallLog::default();
    let enabled: Vec<String> = all_tools()
        .into_iter()
        .filter(|tool| tool != "read_file")
        .collect();
    let mut state = membrane_with(&log, &enabled, None, canned_outcome);

    let error = state
        .open_file_view("src/a.ts".to_string(), None, None)
        .expect_err("reading is withheld this run");
    assert_eq!(error.code, ErrorCode::Unavailable);
    assert!(log.names().is_empty(), "it never reached the api");
}

/// **The view report is bounded, and what it drops is counted.**
///
/// Every kept record is charged to the next turn's window, and a program can refuse in a loop
/// (`for (;;) { try { view.openText("", "") } catch {} }`) far faster than an execution timeout will
/// stop it. Counting the discards is what keeps a truncated report from reading as a program that
/// stopped calling.
#[test]
fn the_view_report_is_capped_and_the_overflow_is_counted() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    for _ in 0..(MAX_RECORDED_VIEW_EVENTS + 25) {
        let _ = state.open_text_view(String::new(), "body".to_string());
    }

    let parts = state.into_parts();
    assert_eq!(parts.view_refusals.len(), MAX_RECORDED_VIEW_EVENTS);
    assert_eq!(parts.views_suppressed, 25);
}
