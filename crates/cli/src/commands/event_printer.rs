//! A live event printer that renders normalized events to the terminal as they
//! arrive.
//!
//! This is what turns a run from a silent wait into a visible stream: each piece
//! of activity — the driver's own setup and teardown stages as well as the
//! harness's work — is rendered on its own line as it happens, and a harness's
//! own diagnostics and errors surface immediately rather than only as a single
//! line once the run fails. `tcab run` drives [`render_event`] from the backend's
//! live job feed, one event per NDJSON line.
//!
//! Each event type's label is colored so the stream is easy to scan. The colors
//! are emitted unconditionally; the [`anstream`] macros used to write the lines
//! strip the escape sequences when the destination is not a terminal (honoring
//! `NO_COLOR` and `CLICOLOR`), so color appears only when attached to a TTY.

use anstyle::{AnsiColor, Color, Style};
use test_cabinet_core::{EventKind, HarnessEvent, OrchestrationAction};

/// Maximum width of a rendered message before it is truncated.
const MAX_WIDTH: usize = 200;

/// Build a foreground-only style from an ANSI color.
const fn fg(color: AnsiColor) -> Style {
    Style::new().fg_color(Some(Color::Ansi(color)))
}

// The per-event-type label colors. Each event kind gets a distinct color so the
// stream is easy to scan; diagnostics are bold to stand out from activity.
const AGENT: Style = fg(AnsiColor::Cyan);
// Reasoning is the model's quiet aside, so it reads in a dimmed magenta italic —
// the same purple family as the web feed's reasoning color, set apart from the
// visible agent message.
const REASONING: Style = fg(AnsiColor::Magenta).italic();
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
// Per-turn token usage is a quiet diagnostic between the activity lines, so it
// reads in the same dim grey as the unknown/system asides.
const USAGE: Style = fg(AnsiColor::BrightBlack);

/// Print one normalized event as a single colored, labeled line.
///
/// Activity goes to standard output; harness warnings and errors go to standard
/// error. The `anstream` macros decide per stream whether to keep or strip the
/// color escapes, so a redirected stream stays plain even when the other is a
/// terminal. This is the shared formatter the live `tcab run` watch renders
/// through.
pub fn render_event(event: &HarnessEvent) {
    let line = render(event);
    match event.kind {
        EventKind::Warning { .. } | EventKind::Error { .. } => {
            anstream::eprintln!("  {line}");
        }
        _ => anstream::println!("  {line}"),
    }
}

/// Render an event as a single colored, labeled, width-limited line.
fn render(event: &HarnessEvent) -> String {
    match &event.kind {
        EventKind::Agent { message } => labeled(AGENT, "agent", message),
        EventKind::Reasoning { message } => labeled(REASONING, "think", message),
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
        EventKind::Usage { tokens, cost } => labeled(USAGE, "usage", &usage_text(tokens, *cost)),
        // gg's native telemetry carry. The gg executor also emits mapped
        // human-facing variants (agent/command/write/…) alongside these, so the
        // rendered feed already shows the activity; render the raw gg event under a
        // dim label so the native stream is still visible without duplicating it.
        EventKind::Gg { event } => labeled(
            UNKNOWN,
            "gg",
            &serde_json::to_string(event).unwrap_or_default(),
        ),
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

/// Summarize a per-turn usage event as a compact one-liner, naming only the token
/// classes the harness reported (an unreported class is omitted rather than shown
/// as zero) and the per-turn cost when one is reported.
fn usage_text(tokens: &test_cabinet_core::metrics::TokenCounts, cost: Option<f64>) -> String {
    let mut parts = Vec::new();
    if let Some(input) = tokens.uncached_input {
        parts.push(format!("in {input}"));
    }
    if let Some(cached) = tokens.cached_input {
        parts.push(format!("cached {cached}"));
    }
    if let Some(output) = tokens.output {
        parts.push(format!("out {output}"));
    }
    if let Some(reasoning) = tokens.reasoning {
        parts.push(format!("reason {reasoning}"));
    }
    if let Some(cost) = cost {
        parts.push(format!("${cost:.4}"));
    }
    if parts.is_empty() {
        "no usage reported".to_string()
    } else {
        parts.join(" · ")
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
