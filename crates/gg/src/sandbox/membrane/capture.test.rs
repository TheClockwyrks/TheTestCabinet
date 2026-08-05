//! Tests for the caps on what a program leaves behind.
//!
//! **No wasm here.** [`MembraneState`] is built directly and the generated `Host` methods are
//! called as ordinary Rust, so a test that drives six hundred calls through the roster costs
//! microseconds rather than a component compile.
//!
//! Every one of these is about the same failure: a program can produce any of these four things in
//! a loop, they are all charged to the next turn's context window, and a cap that discarded
//! silently would be worse than no cap at all.

use std::time::{Duration, Instant};

use serde_json::json;

use super::*;
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome, membrane, membrane_with};
use crate::sandbox::membrane::test_cabinet::gg::feedback::{ErrorKind, Host as FeedbackHost};
use crate::sandbox::membrane::test_cabinet::gg::files::{FileRead, Host as FilesHost};
use crate::tools::{FileImageData, ToolFailure};

/// The three log caps, the count of what they discarded, and — the property the system prompt
/// promises — that what survives is the **tail**.
///
/// Every kept line is charged to the agent's context window next turn, so the cap is real; but a
/// silent cap would make a model believe its loop never ran, so the discards are counted and the
/// feedback says how many. Keeping the tail is what makes "log per item, then log the conclusion"
/// — the shape a model actually writes — deliver the conclusion.
#[test]
fn logs_are_capped_by_lines_bytes_and_line_length_and_the_last_lines_are_the_kept_ones() {
    let log = CallLog::default();

    // Line length: one enormous line cannot spend the whole budget.
    let mut state = membrane(&log);
    state.log("x".repeat(MAX_LOG_LINE_BYTES * 4));
    let parts = state.into_parts();
    assert_eq!(parts.logs.len(), 1);
    assert!(
        parts.logs[0].len() <= MAX_LOG_LINE_BYTES + '…'.len_utf8(),
        "the line was not cut: {} bytes",
        parts.logs[0].len()
    );
    assert!(parts.logs[0].ends_with('…'), "the cut was not marked");

    // Line count: a program logging in a loop is bounded, the evictions are counted, and the
    // summary a model logs last is the one that survives.
    let mut state = membrane(&log);
    for index in 0..MAX_LOG_LINES + 5 {
        state.log(format!("line {index}"));
    }
    let parts = state.into_parts();
    assert_eq!(parts.logs.len(), MAX_LOG_LINES);
    assert_eq!(parts.logs_suppressed, 5);
    assert_eq!(
        parts.logs[0], "line 5",
        "the earliest lines are the evicted ones"
    );
    assert_eq!(
        parts.logs[MAX_LOG_LINES - 1],
        format!("line {}", MAX_LOG_LINES + 4),
        "the last line a program logs is always kept"
    );

    // Total bytes: many medium lines hit the byte ceiling before the line ceiling, and the tail
    // still wins.
    let mut state = membrane(&log);
    for index in 0..40 {
        state.log(format!("{index:04}{}", "y".repeat(1_000)));
    }
    let parts = state.into_parts();
    assert!(
        parts.logs.len() < 40 && parts.logs_suppressed > 0,
        "the byte ceiling did not bind: {} kept, {} suppressed",
        parts.logs.len(),
        parts.logs_suppressed
    );
    assert!(
        parts.logs.last().expect("a kept line").starts_with("0039"),
        "the byte ceiling must evict from the front, not refuse from the back: {:?}",
        parts.logs.last()
    );
    assert_eq!(
        parts.logs.len() as u64 + parts.logs_suppressed,
        40,
        "every line is either kept or counted"
    );
}

/// A multi-byte character at the cut is not split — which would panic — and the marker still lands.
#[test]
fn a_truncated_line_is_cut_on_a_character_boundary() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    // `é` is two bytes, so the byte at the cap lands mid-character for half of them.
    state.log("é".repeat(MAX_LOG_LINE_BYTES));

    let parts = state.into_parts();
    assert!(parts.logs[0].ends_with('…'));
    assert!(parts.logs[0].len() <= MAX_LOG_LINE_BYTES + '…'.len_utf8());
}

/// **The roster is bounded, and what it dropped is counted rather than lost.**
///
/// A bridged call costs ≈0.86 M fuel, so the default ceiling affords a program some 230,000 of
/// them; unbounded, each would push owned strings onto a vector and a line onto a roster the model
/// then has to read. The count is what keeps the arithmetic honest — the turn dispatched
/// `calls.len() + calls_suppressed`, and the telemetry pairs it streamed match that, not the vector.
#[test]
fn the_roster_is_capped_and_what_it_dropped_is_counted() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let attempts = MAX_RECORDED_CALLS + 25;
    for _ in 0..attempts {
        state.list_dir(None).expect("the call is serviced");
    }

    let parts = state.into_parts();
    assert_eq!(
        parts.calls.len(),
        MAX_RECORDED_CALLS,
        "the roster is bounded"
    );
    assert_eq!(parts.calls_suppressed, 25, "and the rest are counted");
    assert_eq!(
        parts.calls.len() as u64 + parts.calls_suppressed,
        attempts as u64,
        "kept plus suppressed must be exactly what the loop was asked to do"
    );
    assert_eq!(
        log.names().len(),
        attempts,
        "every call still reached the loop — only the roster is capped"
    );
}

/// A suppressed record must not be amended: the entry at the end of the vector belongs to an
/// earlier call that really did succeed, and blaming it would make the roster lie twice.
#[test]
fn a_suppressed_record_does_not_corrupt_the_last_kept_one() {
    let log = CallLog::default();
    // Every call succeeds except the sidecar-less one at the end.
    let mut state = membrane_with(&log, &all_tools(), None, |name, args| {
        if name == "read_file" {
            ToolOutcome::ok("listed", "listed")
        } else {
            canned_outcome(name, args)
        }
    });

    for _ in 0..MAX_RECORDED_CALLS {
        state.list_dir(None).expect("the call is serviced");
    }
    state
        .read_file("a.ts".to_string(), None, None)
        .expect_err("the sidecar-less call fails");

    let parts = state.into_parts();
    assert_eq!(parts.calls_suppressed, 1);
    let last = parts.calls.last().expect("the roster is not empty");
    assert_eq!(last.name, "list_dir");
    assert!(
        last.ok,
        "a suppressed failure was blamed on an earlier call"
    );
}

/// Refusals are capped too — and for a sharper reason than the roster.
///
/// Once the run's wall-clock budget is spent **every** call is refused, so a program that swallows
/// the throws (`for (;;) { try { shell("x") } catch {} }`) spins refusing until its fuel runs out.
/// The guard whose whole purpose is "the program stops cleanly" would otherwise be an allocation
/// loop.
#[test]
fn refusals_are_capped_so_a_spent_budget_cannot_grow_them_without_bound() {
    let log = CallLog::default();
    let expired = Instant::now()
        .checked_sub(Duration::from_secs(1))
        .expect("a one-second-old instant exists");
    let mut state = membrane_with(&log, &all_tools(), Some(expired), canned_outcome);

    let attempts = MAX_RECORDED_REFUSALS + 40;
    for _ in 0..attempts {
        state.list_dir(None).expect_err("a spent budget refuses");
    }

    let parts = state.into_parts();
    assert_eq!(parts.refusals.len(), MAX_RECORDED_REFUSALS);
    assert_eq!(parts.refusals_suppressed, 40);
    assert!(parts.calls.is_empty(), "a refusal is never a serviced call");
}

/// **A failure message on the roster is a reminder, not a second copy of the output.**
///
/// The message is the failed outcome's whole `output`, which for `shell` is up to 16 KiB. The
/// program has already seen it; five failing commands would otherwise put 80 KiB of duplicate text
/// into the next turn's window, beside logs that are capped at 16 KiB in total.
#[test]
fn a_long_failure_message_is_capped_on_the_record() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::failed(ToolFailure::IoError, "z".repeat(64 * 1024))
    });

    let error = state.list_dir(None).expect_err("the failing call throws");
    assert_eq!(
        error.message.len(),
        64 * 1024,
        "the PROGRAM still gets the whole message; only the roster's copy is cut"
    );

    let parts = state.into_parts();
    let recorded = parts.calls[0].error.as_deref().expect("a failure message");
    assert!(
        recorded.len() <= MAX_CALL_ERROR_BYTES + '…'.len_utf8(),
        "the roster kept {} bytes",
        recorded.len()
    );
    assert!(recorded.ends_with('…'), "the cut was not marked");
}

/// **A bare `fs.readFile` of a picture shows the model nothing — and says so, with the remedy.**
///
/// Views are the only channel into the window, and a picture is not an exception to that: an image
/// is a file view of an image file. The read still *succeeds* and still returns the descriptor, so a
/// program that reads a mockup to check its size or its format carries on unaffected; what it must
/// not do is believe the model is looking at it. The reason therefore names `view.openFile`, because
/// a program told only that it cannot see the file has been handed a fact with no action attached.
#[test]
fn a_bare_read_of_a_picture_shows_nothing_and_names_the_view_that_would() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let read = state
        .read_file("mock.png".to_string(), None, None)
        .expect("reading a picture still succeeds");
    let FileRead::Image(image) = read else {
        panic!("a .png must read back as a picture");
    };
    assert_eq!(image.media_type, "image/png", "the descriptor is unchanged");
    assert!(!image.shown, "a bare read shows the model nothing");
    let why = image.not_shown_reason.expect("a withheld picture says why");
    assert!(
        why.contains("view.openFile"),
        "the reason must name the way to actually see it: {why}"
    );
}

/// A read that produced **no** picture is left exactly as it was.
///
/// The two refusals [`read_image`](crate::tools) makes on its own — a text-only model, and a file
/// over the display limit — already write an honest `shown: false` with their own reason, and
/// overwriting it with this path's would answer "you cannot see this" with "open a view of it",
/// which is advice that would not work.
#[test]
fn a_read_that_carried_no_picture_is_not_rewritten() {
    let mut outcome = ToolOutcome::ok("`big.png` is a PNG image (9.0 MB).", "too large").with_data(
        ToolData::FileImage(FileImageData {
            media_type: "image/png".to_string(),
            label: "PNG".to_string(),
            bytes: 9_437_184,
            shown: false,
            not_shown_reason: Some("the image is larger than the 4 MB display limit".to_string()),
        }),
    );

    withhold_pictures(&mut outcome);

    let Some(ToolData::FileImage(image)) = outcome.data else {
        panic!("the sidecar survives");
    };
    assert!(!image.shown);
    assert_eq!(
        image.not_shown_reason.as_deref(),
        Some("the image is larger than the 4 MB display limit"),
        "the tool's own reason must not be replaced by this path's"
    );
}

/// A view of a picture reaches this path with its picture already moved into the view item, so
/// nothing is dropped and the sidecar must keep saying the model **is** being shown it.
#[test]
fn a_picture_already_taken_into_a_view_keeps_its_shown_flag() {
    let mut outcome = ToolOutcome::ok("`mock.png` — PNG image, 45 KB. The image follows.", "read")
        .with_data(ToolData::FileImage(FileImageData {
            media_type: "image/png".to_string(),
            label: "PNG".to_string(),
            bytes: 46_080,
            shown: true,
            not_shown_reason: None,
        }));

    withhold_pictures(&mut outcome);

    let Some(ToolData::FileImage(image)) = outcome.data else {
        panic!("the sidecar survives");
    };
    assert!(
        image.shown,
        "a view's picture is in the window; saying otherwise would make the model ignore it"
    );
    assert!(image.not_shown_reason.is_none());
}

/// The deferred-work note is recorded once: the shim sends it at most once per run, and a second
/// would say nothing new.
#[test]
fn a_deferred_note_is_recorded_once() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.report_deferred("the first note".to_string());
    state.report_deferred("a later note".to_string());

    let parts = state.into_parts();
    assert_eq!(parts.deferred_note.as_deref(), Some("the first note"));
}

/// The program's throw is recorded once, and its kind is carried across as a value rather than
/// re-derived from the message.
#[test]
fn a_program_error_is_recorded_once_with_its_kind() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.report_error(feedback::ProgramError {
        kind: ErrorKind::UnknownName,
        code: None,
        message: "enterPlanMode is not defined".to_string(),
        location: Some("line 3, column 1".to_string()),
    });
    state.report_error(feedback::ProgramError {
        kind: ErrorKind::Other,
        code: None,
        message: "a later error".to_string(),
        location: None,
    });

    let parts = state.into_parts();
    let error = parts.program_error.expect("the throw was recorded");
    assert_eq!(error.kind, ProgramErrorKind::UnknownName);
    assert_eq!(error.message, "enterPlanMode is not defined");
    assert_eq!(error.location.as_deref(), Some("line 3, column 1"));
}

/// The record deliberately keeps no arguments: the loop already emits the same `Value` as `ToolCall`
/// telemetry and hands it to the replay recorder, so a second retained copy would be pure waste.
#[test]
fn the_record_keeps_the_summary_but_never_the_arguments() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .write_file("out.txt".to_string(), "hello".to_string())
        .expect("wrote");

    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out.txt", "contents": "hello" })),
        "the arguments still reach the loop"
    );
    let parts = state.into_parts();
    assert_eq!(parts.calls[0].summary.as_deref(), Some("wrote"));
    assert!(parts.calls[0].error.is_none());
}

/// **The host classifies a refused call, not the guest.**
///
/// `unavailable` means the model reached for something this run does not offer it, and that is the
/// same fact — and the same recovery — as a name that was never in scope. Which of the two a guest
/// raises depends only on whether its SDK can withhold a name: one raises a `ReferenceError` and
/// reports `unknown-name`, the other is refused at the membrane and would report `tool-failure`.
/// Deciding it from the *code* is what stops one event becoming two turn-error metrics, one per
/// language arm.
#[test]
fn a_refused_call_is_classified_by_its_code_rather_than_by_the_guests_reading() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.report_error(feedback::ProgramError {
        kind: ErrorKind::ToolFailure,
        code: Some(ErrorCode::Unavailable),
        message: "`approve` failed (unavailable): not your ending".to_string(),
        location: None,
    });

    assert_eq!(
        state
            .into_parts()
            .program_error
            .expect("the throw was recorded")
            .kind,
        ProgramErrorKind::UnknownName,
    );
}

/// Every other failure class stays what the call said it was, and a throw with no code at all is the
/// program's own — there the guest's reading is the only reading there is.
#[test]
fn a_throw_that_is_not_a_refusal_keeps_the_class_it_arrived_with() {
    for (code, kind, want) in [
        (
            Some(ErrorCode::NotFound),
            ErrorKind::ToolFailure,
            ProgramErrorKind::ToolFailure,
        ),
        (
            Some(ErrorCode::LimitExceeded),
            ErrorKind::ToolFailure,
            ProgramErrorKind::ToolFailure,
        ),
        (None, ErrorKind::UnknownName, ProgramErrorKind::UnknownName),
        (None, ErrorKind::Other, ProgramErrorKind::Other),
    ] {
        let log = CallLog::default();
        let mut state = membrane(&log);

        state.report_error(feedback::ProgramError {
            kind,
            code,
            message: "something went wrong".to_string(),
            location: None,
        });

        assert_eq!(
            state
                .into_parts()
                .program_error
                .expect("the throw was recorded")
                .kind,
            want,
            "{code:?} / {kind:?}"
        );
    }
}
