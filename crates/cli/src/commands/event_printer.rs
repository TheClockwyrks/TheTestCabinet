//! A live [`EventSink`] that prints normalized events to the terminal as they
//! arrive.
//!
//! This is what turns a run from a silent wait into a visible stream: each piece
//! of activity — the orchestrator's own setup and teardown stages as well as the
//! harness's work — is rendered on its own line as it happens, and a harness's
//! own diagnostics and errors surface immediately rather than only as a single
//! line once the run fails.
//!
//! Each event type's label is colored so the stream is easy to scan. The colors
//! are emitted unconditionally; the [`anstream`] macros used to write the lines
//! strip the escape sequences when the destination is not a terminal (honoring
//! `NO_COLOR` and `CLICOLOR`), so color appears only when attached to a TTY.

use anstyle::{AnsiColor, Color, Style};
use test_cabinet_core::{EventKind, EventSink, HarnessEvent, OrchestrationAction};

/// Maximum width of a rendered message before it is truncated.
const MAX_WIDTH: usize = 200;

/// Build a foreground-only style from an ANSI color.
const fn fg(color: AnsiColor) -> Style {
    Style::new().fg_color(Some(Color::Ansi(color)))
}

// The per-event-type label colors. Each event kind gets a distinct color so the
// stream is easy to scan; diagnostics are bold to stand out from activity.
const AGENT: Style = fg(AnsiColor::Cyan);
const COMMAND: Style = fg(AnsiColor::Yellow);
const READ: Style = fg(AnsiColor::Blue);
const WRITE: Style = fg(AnsiColor::Green);
const SEARCH: Style = fg(AnsiColor::Magenta);
const LIST: Style = fg(AnsiColor::BrightBlue);
const SKILL: Style = fg(AnsiColor::BrightMagenta);
const SUBAGENT: Style = fg(AnsiColor::BrightCyan);
const SYSTEM: Style = fg(AnsiColor::White);
const UNKNOWN: Style = fg(AnsiColor::BrightBlack);
const WARNING: Style = fg(AnsiColor::Yellow).bold();
const ERROR: Style = fg(AnsiColor::Red).bold();

/// An [`EventSink`] that writes a one-line summary of every event to the
/// terminal. Activity goes to standard output; harness warnings and errors go to
/// standard error.
#[derive(Debug, Default, Clone, Copy)]
pub struct PrintingEventSink;

impl EventSink for PrintingEventSink {
    fn emit(&mut self, event: &HarnessEvent) {
        let line = render(event);
        // Harness diagnostics belong on standard error; all other activity goes
        // to standard output. The `anstream` macros decide per stream whether to
        // keep or strip the color escapes, so a redirected stream stays plain
        // even when the other is a terminal.
        match event.kind {
            EventKind::Warning { .. } | EventKind::Error { .. } => {
                anstream::eprintln!("  {line}");
            }
            _ => anstream::println!("  {line}"),
        }
    }
}

/// Render an event as a single colored, labeled, width-limited line.
fn render(event: &HarnessEvent) -> String {
    match &event.kind {
        EventKind::Agent { message } => labeled(AGENT, "agent", message),
        EventKind::Command {
            command,
            exit_code,
            is_success,
            ..
        } => labeled(
            COMMAND,
            "cmd",
            &command_text(command, *exit_code, *is_success),
        ),
        EventKind::Read {
            path,
            start_line,
            end_line,
            ..
        } => labeled(READ, "read", &path_with_range(path, *start_line, *end_line)),
        EventKind::Write { path, .. } => labeled(WRITE, "write", path),
        EventKind::Search { query, .. } => labeled(SEARCH, "search", query),
        EventKind::List { path, .. } => labeled(LIST, "list", path.as_deref().unwrap_or(".")),
        EventKind::Skill {
            path, skill_name, ..
        } => labeled(SKILL, "skill", skill_name.as_deref().unwrap_or(path)),
        EventKind::Orchestration {
            action,
            subagent_name,
            ..
        } => labeled(
            SUBAGENT,
            "subagent",
            &orchestration_text(*action, subagent_name.as_deref()),
        ),
        EventKind::System { message, .. } => labeled(SYSTEM, "system", message),
        EventKind::Unknown { raw } => labeled(UNKNOWN, "·", &raw.to_string()),
        EventKind::Warning { message, .. } => labeled(WARNING, "warn", message),
        EventKind::Error { message, .. } => labeled(ERROR, "error", message),
    }
}

/// Render a colored label and a message as a single aligned, width-limited line.
///
/// The label is padded to a fixed width and wrapped in the style's escape
/// sequences. An empty [`Style`] renders no sequences, and [`anstream`] strips
/// them entirely when the destination is not a terminal.
fn labeled(style: Style, label: &str, message: &str) -> String {
    format!(
        "{}{label:<7}{} {}",
        style.render(),
        style.render_reset(),
        one_line(message)
    )
}

/// Describe a command, noting a non-zero exit when one is known.
fn command_text(command: &str, exit_code: Option<i32>, is_success: Option<bool>) -> String {
    match (is_success, exit_code) {
        (Some(false), Some(code)) => format!("{command} (exit {code})"),
        (Some(false), None) => format!("{command} (failed)"),
        _ => command.to_string(),
    }
}

/// Append a line range to a path when one is known, for example `path:10-20`.
fn path_with_range(path: &str, start: Option<u32>, end: Option<u32>) -> String {
    match (start, end) {
        (Some(start), Some(end)) if start != end => format!("{path}:{start}-{end}"),
        (Some(start), _) => format!("{path}:{start}"),
        _ => path.to_string(),
    }
}

/// Describe a subagent orchestration action.
fn orchestration_text(action: OrchestrationAction, name: Option<&str>) -> String {
    let verb = match action {
        OrchestrationAction::SubagentStarted => "started",
        OrchestrationAction::SubagentCompleted => "completed",
        OrchestrationAction::SubagentFailed => "failed",
    };
    match name {
        Some(name) => format!("{verb} {name}"),
        None => verb.to_string(),
    }
}

/// Collapse whitespace to single spaces and truncate to [`MAX_WIDTH`].
fn one_line(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= MAX_WIDTH {
        return collapsed;
    }
    let truncated: String = collapsed.chars().take(MAX_WIDTH).collect();
    format!("{truncated}…")
}

#[cfg(test)]
#[path = "event_printer.test.rs"]
mod tests;
