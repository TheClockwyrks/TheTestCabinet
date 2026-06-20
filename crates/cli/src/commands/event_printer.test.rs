//! Tests for the event printer's line formatting helpers.

use super::*;
use test_cabinet_core::{SystemStage, SystemStatus};

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
    // An empty style renders no escape sequences, so only the padded label shows.
    assert_eq!(labeled(Style::new(), "cmd", "ls"), "cmd     ls");
}

#[test]
fn labeled_wraps_the_padded_label_in_the_style_escapes() {
    // Cyan is `\x1b[36m`; the reset is `\x1b[0m`. The escapes bracket the padded
    // label (including its trailing spaces), and the message stays uncolored.
    assert_eq!(
        labeled(fg(AnsiColor::Cyan), "agent", "hi"),
        "\u{1b}[36magent  \u{1b}[0m hi"
    );
}

#[test]
fn event_kinds_each_get_a_distinct_color() {
    let styles = [
        AGENT, REASONING, COMMAND, READ, WRITE, SEARCH, LIST, SKILL, SUBAGENT, SYSTEM, UNKNOWN,
        WARNING, ERROR,
    ];
    for (index, style) in styles.iter().enumerate() {
        for other in &styles[index + 1..] {
            assert_ne!(style, other, "two event kinds share a color");
        }
    }
}

#[test]
fn render_applies_the_matching_label_and_style_per_event_kind() {
    // Each kind renders identically to invoking `labeled` with its own style and
    // label, which pins both the routing of kind to color and the wording without
    // hard-coding the exact escape bytes of every color.
    let cases = [
        (
            EventKind::Agent {
                message: "hello".to_string(),
            },
            labeled(AGENT, "agent", "hello"),
        ),
        (
            EventKind::Reasoning {
                message: "let me think".to_string(),
            },
            labeled(REASONING, "think", "let me think"),
        ),
        (
            EventKind::Write {
                path: "src/main.rs".to_string(),
                start_line: None,
                end_line: None,
                is_success: Some(true),
            },
            labeled(WRITE, "write", "src/main.rs"),
        ),
        (
            EventKind::Warning {
                message: "careful".to_string(),
                code: None,
            },
            labeled(WARNING, "warn", "careful"),
        ),
        (
            EventKind::Error {
                message: "boom".to_string(),
                code: None,
            },
            labeled(ERROR, "error", "boom"),
        ),
        (
            EventKind::System {
                stage: SystemStage::PullImage,
                status: SystemStatus::Started,
                message: "Pulling the run-container image".to_string(),
            },
            labeled(SYSTEM, "system", "Pulling the run-container image"),
        ),
    ];
    for (kind, expected) in cases {
        assert_eq!(render(&event(kind)), expected);
    }
}

/// A bare [`HarnessEvent`] wrapping the given kind, for rendering tests.
fn event(kind: EventKind) -> HarnessEvent {
    HarnessEvent {
        timestamp: String::new(),
        session_id: None,
        kind,
    }
}
