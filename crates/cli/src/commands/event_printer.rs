//! A live [`EventSink`] that prints normalized harness events to the terminal as
//! they arrive.
//!
//! This is what turns a run from a silent wait into a visible stream: each piece
//! of harness activity is rendered on its own line as the harness produces it,
//! and a harness's own diagnostics and errors surface immediately rather than
//! only as a single line once the run fails.

use test_cabinet_core::{EventKind, EventSink, HarnessEvent, OrchestrationAction};

/// Maximum width of a rendered message before it is truncated.
const MAX_WIDTH: usize = 200;

/// An [`EventSink`] that writes a one-line summary of every event to the
/// terminal. Activity goes to standard output; harness warnings and errors go to
/// standard error.
#[derive(Debug, Default, Clone, Copy)]
pub struct PrintingEventSink;

impl EventSink for PrintingEventSink {
    fn emit(&mut self, event: &HarnessEvent) {
        match &event.kind {
            EventKind::Agent { message } => println!("  {}", labeled("agent", message)),
            EventKind::Command {
                command,
                exit_code,
                is_success,
                ..
            } => println!(
                "  {}",
                labeled("cmd", &command_text(command, *exit_code, *is_success))
            ),
            EventKind::Read {
                path,
                start_line,
                end_line,
                ..
            } => println!(
                "  {}",
                labeled("read", &path_with_range(path, *start_line, *end_line))
            ),
            EventKind::Write { path, .. } => println!("  {}", labeled("write", path)),
            EventKind::Search { query, .. } => println!("  {}", labeled("search", query)),
            EventKind::List { path, .. } => {
                println!("  {}", labeled("list", path.as_deref().unwrap_or(".")))
            }
            EventKind::Skill {
                path, skill_name, ..
            } => println!(
                "  {}",
                labeled("skill", skill_name.as_deref().unwrap_or(path))
            ),
            EventKind::Orchestration {
                action,
                subagent_name,
                ..
            } => println!(
                "  {}",
                labeled(
                    "subagent",
                    &orchestration_text(*action, subagent_name.as_deref())
                )
            ),
            EventKind::Unknown { raw } => println!("  {}", labeled("·", &raw.to_string())),
            EventKind::Warning { message, .. } => eprintln!("  {}", labeled("warn", message)),
            EventKind::Error { message, .. } => eprintln!("  {}", labeled("error", message)),
        }
    }
}

/// Render a label and a message as a single aligned, width-limited line.
fn labeled(label: &str, message: &str) -> String {
    format!("{label:<7} {}", one_line(message))
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
