//! Tests for the event printer's line formatting helpers.

use super::*;

#[test]
fn one_line_collapses_whitespace() {
    assert_eq!(one_line("a  b\n\tc"), "a b c");
}

#[test]
fn one_line_truncates_overlong_text_with_an_ellipsis() {
    let long = "x".repeat(MAX_WIDTH + 50);
    let rendered = one_line(&long);
    assert_eq!(rendered.chars().count(), MAX_WIDTH + 1); // MAX_WIDTH chars + ellipsis
    assert!(rendered.ends_with('…'));
}

#[test]
fn command_text_notes_a_failing_exit_code() {
    assert_eq!(
        command_text("npm test", Some(1), Some(false)),
        "npm test (exit 1)"
    );
    assert_eq!(
        command_text("npm test", None, Some(false)),
        "npm test (failed)"
    );
    // A successful or unknown outcome shows the bare command.
    assert_eq!(command_text("ls", Some(0), Some(true)), "ls");
    assert_eq!(command_text("ls", None, None), "ls");
}

#[test]
fn path_with_range_renders_known_line_ranges() {
    assert_eq!(path_with_range("a.ts", Some(10), Some(20)), "a.ts:10-20");
    assert_eq!(path_with_range("a.ts", Some(5), Some(5)), "a.ts:5");
    assert_eq!(path_with_range("a.ts", Some(5), None), "a.ts:5");
    assert_eq!(path_with_range("a.ts", None, None), "a.ts");
}

#[test]
fn orchestration_text_describes_the_action() {
    assert_eq!(
        orchestration_text(OrchestrationAction::SubagentStarted, Some("reviewer")),
        "started reviewer"
    );
    assert_eq!(
        orchestration_text(OrchestrationAction::SubagentFailed, None),
        "failed"
    );
}

#[test]
fn labeled_pads_short_labels() {
    assert_eq!(labeled("cmd", "ls"), "cmd     ls");
}
