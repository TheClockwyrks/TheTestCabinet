//! Tests for the workspace half of the membrane. No wasm: the `Host` methods are called directly.

use std::time::{Duration, Instant};

use serde_json::json;

use super::super::ErrorCode;
use super::*;
use crate::sandbox::fake::{CallLog, all_tools, canned_outcome, membrane, membrane_with};
use crate::tools::{ToolFailure, ToolOutcome};

/// **The single most important behavioural test in this suite.** A non-zero exit is a SUCCESS of
/// the call: `shell("npm test")` has to be usable inside an expression, and a regression here would
/// make every program that checks whether something passed throw instead.
#[test]
fn shell_returns_a_non_zero_exit_as_a_value_not_an_error() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let output = state
        .shell("npm test -- --fail".to_string(), None)
        .expect("a non-zero exit is not a failure of the call");

    assert_eq!(output.exit_code, Some(1));
    assert!(output.output.contains("npm test"), "{}", output.output);
    assert!(!output.truncated);
}

/// **And the roster says the same thing the program was told.**
///
/// A process that exits non-zero leaves `ok: false` on the outcome with no failure classification —
/// which for every other tool means the call failed. Recording that verbatim would make the next
/// turn's roster read `shell → failed: <the whole command output>` for every `shell("npm test")`
/// that found a bug, contradicting the program (which branched on `exitCode` and returned cleanly),
/// the WIT, and this module's own rule.
#[test]
fn a_non_zero_shell_exit_is_recorded_as_a_completed_call() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .shell("npm test -- --fail".to_string(), None)
        .expect("a non-zero exit is not a failure of the call");

    let parts = state.into_parts();
    assert_eq!(parts.calls.len(), 1);
    assert!(
        parts.calls[0].ok,
        "a process that ran is a completed call whatever it exited with"
    );
    assert_eq!(
        parts.calls[0].summary.as_deref(),
        Some("exited 1"),
        "the exit code belongs in the summary, where the roster reads it"
    );
    assert!(
        parts.calls[0].error.is_none(),
        "the command's output is not a failure message: {:?}",
        parts.calls[0].error
    );
}

/// A command that could not be launched — or one the timeout killed — has no `shell` sidecar, and
/// that absence is what makes it a genuine failure rather than a completed process. *That* is
/// recorded as a failed call, which is the other half of the rule above.
#[test]
fn a_shell_timeout_is_a_limit_exceeded_error() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::failed(
            ToolFailure::LimitExceeded,
            "shell: command timed out after 120s and was killed",
        )
    });

    let error = state
        .shell("sleep 600".to_string(), None)
        .expect_err("a killed process throws");

    assert_eq!(error.code, ErrorCode::LimitExceeded);
    assert_eq!(error.tool, "shell");
    assert!(error.message.contains("timed out"), "{}", error.message);

    let parts = state.into_parts();
    assert!(!parts.calls[0].ok, "no process ran, so the call failed");
    assert!(parts.calls[0].error.is_some());
}

/// **An absurd timeout is clamped rather than reaching a `Duration` that cannot hold it.**
///
/// `Duration::from_secs_f64` panics above ~1.8×10¹⁹ seconds, and `shell`'s own argument parsing
/// calls it for anything finite and positive — so without an upper clamp `shell(cmd, { timeoutSecs:
/// 1e300 })` from a one-line program panics inside the tool, on the async loop, in the turn's own
/// future. The run with **no deadline** is the case that matters: there is nothing else to clamp
/// against.
#[test]
fn an_absurd_shell_timeout_is_clamped_rather_than_overflowing_a_duration() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.shell("ls".to_string(), Some(1e300)).expect("ran");

    let forwarded = log
        .args("shell")
        .and_then(|args| args.get("timeout_secs").and_then(serde_json::Value::as_f64))
        .expect("the call carried a timeout");
    assert_eq!(forwarded, MAX_TIMEOUT_SECS);
    // The value the tool will actually build a `Duration` from, which is where the panic was.
    assert!(
        Duration::try_from_secs_f64(forwarded).is_ok(),
        "the clamped timeout is not representable as a Duration: {forwarded}"
    );
}

/// The absolute ceiling binds independently of the run's budget, and the tighter of the two wins.
#[test]
fn the_remaining_budget_still_wins_when_it_is_tighter_than_the_ceiling() {
    let log = CallLog::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut state = membrane_with(&log, &all_tools(), Some(deadline), canned_outcome);

    state.shell("ls".to_string(), Some(1e300)).expect("ran");

    let forwarded = log
        .args("shell")
        .and_then(|args| args.get("timeout_secs").and_then(serde_json::Value::as_f64))
        .expect("the call carried a timeout");
    assert!(
        (0.0..=5.0).contains(&forwarded),
        "the budget must bound the ceiling, not the other way round: {forwarded}"
    );
}

/// A call with no timeout gets gg's own default, so the tool never sees an unbounded command.
#[test]
fn a_shell_call_defaults_to_ggs_own_timeout() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.shell("ls".to_string(), None).expect("ran");

    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "ls", "timeout_secs": DEFAULT_TIMEOUT_SECS }))
    );
}

/// **A model-supplied timeout cannot outlive the run.** A host function cannot trap, so nothing can
/// cut a call short once it is in flight: this clamp is the only thing keeping one `shell` from
/// carrying the whole run past its deadline.
#[test]
fn a_shell_timeout_is_clamped_to_the_remaining_run_budget() {
    let log = CallLog::default();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut state = membrane_with(&log, &all_tools(), Some(deadline), canned_outcome);

    state
        .shell("sleep 600".to_string(), Some(600.0))
        .expect("ran");

    let timeout = log
        .args("shell")
        .and_then(|args| args.get("timeout_secs").and_then(serde_json::Value::as_f64))
        .expect("the call carried a timeout");
    assert!(
        (0.0..=5.0).contains(&timeout),
        "the 600s request was not clamped to the ~5s of budget left: {timeout}"
    );
}

/// With no deadline there is nothing to clamp to, and the program's own request stands.
#[test]
fn a_shell_timeout_without_a_deadline_is_the_programs_own() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.shell("ls".to_string(), Some(30.0)).expect("ran");

    assert_eq!(
        log.args("shell"),
        Some(json!({ "command": "ls", "timeout_secs": 30.0 }))
    );
}

/// A guest that sent a nonsense timeout (the SDK rejects these, so this is the backstop) falls back
/// to the default rather than passing on something the tool would only refuse.
#[test]
fn a_nonsense_shell_timeout_falls_back_to_the_default() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.shell("ls".to_string(), Some(-4.0)).expect("ran");

    assert_eq!(
        log.args("shell")
            .and_then(|args| args.get("timeout_secs").and_then(serde_json::Value::as_f64)),
        Some(DEFAULT_TIMEOUT_SECS)
    );
}

/// A text read comes back as the `text` case, carrying the window it returned rather than a
/// sentence about it.
#[test]
fn read_file_returns_text_with_its_window() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let read = state
        .read_file("src/a.ts".to_string(), None, Some(200))
        .expect("read");

    let FileRead::Text(text) = read else {
        panic!("a .ts file must read back as text");
    };
    assert!(text.contents.contains("contents of src/a.ts"));
    assert_eq!(
        (text.first_line, text.last_line, text.total_lines),
        (1, 2, 2)
    );
    assert!(!text.byte_truncated);
    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "src/a.ts", "offset": null, "limit": 200 }))
    );
}

/// `offset: 0` means "from the start", and is read that way rather than argued with.
///
/// The membrane's type admits zero, the signature the model is shown says nothing about a base, and
/// gg's `read_file` counts from one and rejects zero as an invalid argument. Spending a turn on
/// that would be spending it on a constraint the model was never told about.
#[test]
fn a_zero_offset_reads_from_the_first_line() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state
        .read_file("src/a.ts".to_string(), Some(0), Some(20))
        .expect("read");

    assert_eq!(
        log.args("read_file"),
        Some(json!({ "path": "src/a.ts", "offset": FIRST_LINE_OFFSET, "limit": 20 })),
    );
}

/// A picture is a different *case*, so a program that treats one as text is caught by the variant
/// rather than silently writing an empty string somewhere. The program reads its description; the
/// bytes go nowhere, because a bare read is not a channel into the window — see
/// [`withhold_pictures`](super::capture::withhold_pictures).
#[test]
fn read_file_returns_image_metadata_without_showing_the_picture() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let read = state
        .read_file("mock.png".to_string(), None, None)
        .expect("read");

    let FileRead::Image(image) = read else {
        panic!("a .png must read back as a picture");
    };
    assert_eq!(image.media_type, "image/png");
    assert_eq!(image.label, "PNG");
    assert_eq!(image.bytes, 1_234);
    assert!(
        !image.shown,
        "a bare read describes a picture; it does not show it"
    );
    assert!(
        image
            .not_shown_reason
            .is_some_and(|why| why.contains("gg.views.openFile")),
        "the descriptor has to name the call that would show it"
    );
}

/// The byte count comes back as a number a program can add up, not as prose to parse.
#[test]
fn write_file_returns_the_byte_count() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let bytes = state
        .write_file("out.txt".to_string(), "hello".to_string())
        .expect("wrote");

    assert_eq!(bytes, 5);
    assert_eq!(
        log.args("write_file"),
        Some(json!({ "path": "out.txt", "contents": "hello" }))
    );
}

/// An ambiguous edit is a `conflict` with the count in its message — the class is a value to branch
/// on, and the count stays in the prose rather than becoming a field that every other tool's error
/// would then carry for nothing.
#[test]
fn edit_file_reports_ambiguity_as_a_conflict() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::failed(
            ToolFailure::Conflict,
            "edit_file: `old_string` is not unique (3 occurrences)",
        )
    });

    let error = state
        .edit_file("a.ts".to_string(), "x".to_string(), "y".to_string())
        .expect_err("an ambiguous edit throws");

    assert_eq!(error.code, ErrorCode::Conflict);
    assert!(error.message.contains("3 occurrences"), "{}", error.message);
    assert_eq!(
        log.args("edit_file"),
        Some(json!({ "path": "a.ts", "old_string": "x", "new_string": "y" }))
    );
}

/// The listing carries each entry's kind, which is the fact `list_dir`'s prose throws away into a
/// trailing slash — and the fact a program filters on.
#[test]
fn list_dir_returns_typed_entries() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    let entries = state.list_dir(Some("src".to_string())).expect("listed");

    assert_eq!(entries.len(), 3);
    assert_eq!(entries[0].name, "a.ts");
    assert_eq!(entries[0].kind, EntryKind::File);
    assert_eq!(entries[2].name, "sub");
    assert_eq!(entries[2].kind, EntryKind::Directory);
    assert_eq!(log.args("list_dir"), Some(json!({ "path": "src" })));
}

/// An empty directory is an empty list, not a failure: `listDir(d).length === 0` has to be an
/// ordinary thing for a program to ask.
#[test]
fn an_empty_directory_is_an_empty_list_not_an_error() {
    let log = CallLog::default();
    let mut state = membrane_with(&log, &all_tools(), None, |_, _| {
        ToolOutcome::ok("(empty directory)", "0 entries")
            .with_data(crate::tools::ToolData::DirEntries(Vec::new()))
    });

    let entries = state.list_dir(None).expect("an empty directory lists");
    assert!(entries.is_empty());
}

/// An absent optional argument is lowered as an explicit JSON null rather than an omitted key —
/// the membrane's one rule, which every gg tool's argument helper already accepts.
#[test]
fn an_absent_path_is_lowered_as_null() {
    let log = CallLog::default();
    let mut state = membrane(&log);

    state.list_dir(None).expect("listed");

    assert_eq!(log.args("list_dir"), Some(json!({ "path": null })));
}
