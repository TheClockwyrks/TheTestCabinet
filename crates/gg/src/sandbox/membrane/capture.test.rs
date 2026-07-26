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
use crate::model::ImageContent;
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

/// Pictures are attached up to the budget; beyond it they are counted, and the read still succeeds
/// with a description that says plainly it is not being shown.
#[test]
fn images_are_collected_up_to_the_budget_and_the_rest_are_counted() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    for index in 0..IMAGE_BUDGET + 2 {
        let read = state
            .read_file(format!("mock-{index}.png"), None, None)
            .expect("reading a picture succeeds");
        let FileRead::Image(image) = read else {
            panic!("a .png must read back as a picture");
        };
        if index < IMAGE_BUDGET {
            assert!(image.shown, "picture {index} was within the budget");
            assert!(image.not_shown_reason.is_none());
        } else {
            assert!(!image.shown, "picture {index} was past the budget");
            assert!(
                image
                    .not_shown_reason
                    .as_deref()
                    .is_some_and(|reason| reason.contains("at most")),
                "the reason must name the budget: {:?}",
                image.not_shown_reason
            );
        }
    }

    let parts = state.into_parts();
    assert_eq!(parts.images.len() as u32, IMAGE_BUDGET);
    assert_eq!(parts.images_dropped, 2);
}

/// A picture that WAS attached is never described as unshown.
///
/// The description belongs to the outcome's first picture. An outcome carrying several — which gg
/// has no tool that produces today, and which the collection is nonetheless written to handle — must
/// not have its attached first picture relabelled because a later one hit the budget.
#[test]
fn an_attached_picture_is_not_described_as_unshown_because_a_later_one_was_dropped() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let mut outcome = ToolOutcome::ok("[PNG image]", "read an image")
        .with_images(vec![
            ImageContent::new("image/png", "aGk=", 1),
            ImageContent::new("image/png", "aGk=", 2),
        ])
        .with_data(ToolData::FileImage(FileImageData {
            media_type: "image/png".to_string(),
            label: "PNG".to_string(),
            bytes: 1,
            shown: true,
            not_shown_reason: None,
        }));

    // One slot left in the budget: the first picture is attached, the second is not.
    for index in 0..IMAGE_BUDGET - 1 {
        state
            .read_file(format!("mock-{index}.png"), None, None)
            .expect("reading a picture succeeds");
    }
    state.collect_images(&mut outcome);

    let Some(ToolData::FileImage(image)) = outcome.data else {
        panic!("the sidecar survived the collection");
    };
    assert!(
        image.shown,
        "the picture the model IS being shown was described as unshown"
    );
    assert_eq!(state.into_parts().images_dropped, 1);
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
        message: "enterPlanMode is not defined".to_string(),
        location: Some("line 3, column 1".to_string()),
    });
    state.report_error(feedback::ProgramError {
        kind: ErrorKind::Other,
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
