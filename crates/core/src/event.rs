//! Normalized harness events: a single event taxonomy that every supported
//! harness's raw output is translated into.
//!
//! See `docs/events.md`. While a harness runs it reports activity — commands,
//! file operations, assistant messages, and its own diagnostics — in a harness
//! specific format. This module defines the normalized [`HarnessEvent`] types and
//! the [`EventParser`] that converts each harness's raw output lines into them,
//! so callers can observe a run live through one uniform stream regardless of
//! which harness produced it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::execution::OutputStream;

/// A single normalized event emitted while a harness runs.
///
/// The common fields (timestamp and optional session ID) are carried alongside
/// the type specific [`EventKind`], which is flattened into the serialized form
/// so the type discriminator and its fields sit inline rather than under a
/// nested payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessEvent {
    /// ISO 8601 time the event was observed by the testing harness.
    pub timestamp: String,
    /// The underlying harness's session identifier, when one is known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// The type specific event data.
    #[serde(flatten)]
    pub kind: EventKind,
}

/// The normalized event types, discriminated by the `type` field.
///
/// Variant tags are the discriminator slugs defined in `docs/events.md`
/// (`agent`, `command`, and so on); type specific fields are camelCased.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum EventKind {
    /// A plain natural language message emitted by the agent.
    Agent {
        /// The text the agent emitted.
        message: String,
    },
    /// A shell command the agent ran.
    Command {
        /// The shell command the agent attempted to run.
        command: String,
        /// The directory the command ran from, when reported.
        #[serde(skip_serializing_if = "Option::is_none")]
        working_directory: Option<String>,
        /// The process exit code, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        /// Whether the command succeeded, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A file read.
    Read {
        /// The file that was read.
        path: String,
        /// The inclusive start line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        /// The inclusive end line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
        /// Whether the read succeeded, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A file write.
    Write {
        /// The file that was written.
        path: String,
        /// The inclusive start line written, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        /// The inclusive end line written, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
        /// Whether the write succeeded, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A filesystem or in-file search.
    Search {
        /// The search pattern, glob, or file name searched for.
        query: String,
        /// The scope that was searched, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// Whether the search completed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// A directory listing.
    List {
        /// The directory whose contents were listed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
        /// Whether the listing completed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// Use of a skill, when the harness distinguishes it from a file read.
    Skill {
        /// The skill file that was read.
        path: String,
        /// The harness provided skill name, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        skill_name: Option<String>,
        /// The inclusive start line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        start_line: Option<u32>,
        /// The inclusive end line read, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        end_line: Option<u32>,
        /// Whether the skill use completed, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// Subagent orchestration activity.
    Orchestration {
        /// The orchestration state the harness reported.
        action: OrchestrationAction,
        /// The harness provided subagent identifier, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        subagent_id: Option<String>,
        /// The harness provided subagent name, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        subagent_name: Option<String>,
        /// Whether the action completed successfully, when known.
        #[serde(skip_serializing_if = "Option::is_none")]
        is_success: Option<bool>,
    },
    /// An error reported by the harness itself (not an agent caused error).
    Error {
        /// A human readable description of the error.
        message: String,
        /// A harness provided stable error code, when one exists.
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// A potential issue reported by the harness.
    Warning {
        /// A human readable description of the potential issue.
        message: String,
        /// A harness provided stable warning code, when one exists.
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// Harness output that could not be classified as any other type.
    Unknown {
        /// The original, unclassified harness output.
        raw: Value,
    },
}

/// The subagent orchestration states a harness can report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestrationAction {
    /// A subagent began running.
    SubagentStarted,
    /// A subagent finished successfully.
    SubagentCompleted,
    /// A subagent failed.
    SubagentFailed,
}

/// Receives [`HarnessEvent`]s as they are produced during an invocation.
///
/// Callers implement this to observe a run live; the command line interface
/// prints events as they arrive, and tests can use [`NoopEventSink`] to ignore
/// them.
pub trait EventSink: Send {
    /// Handle a single event. Called in the order events are produced, before the
    /// invocation completes.
    fn emit(&mut self, event: &HarnessEvent);
}

/// An [`EventSink`] that discards every event.
#[derive(Debug, Default, Clone, Copy)]
pub struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn emit(&mut self, _event: &HarnessEvent) {}
}

/// How a harness's raw output is translated into normalized events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventFormat {
    /// Codex's `codex exec --json` JSONL stream, mapped per `docs/events.md`.
    Codex,
    /// A best effort mapping for harnesses not yet modeled in detail: standard
    /// output lines become unknown events and diagnostics surface as warnings.
    Generic,
}

/// Translates a harness's raw output lines into normalized [`HarnessEvent`]s.
///
/// The parser is stateful so it can carry forward information discovered earlier
/// in the stream, such as the session ID a harness reports once and then applies
/// to every subsequent event.
#[derive(Debug, Clone)]
pub struct EventParser {
    format: EventFormat,
    session_id: Option<String>,
}

impl EventParser {
    /// Create a parser for the given harness output format.
    pub fn new(format: EventFormat) -> Self {
        Self {
            format,
            session_id: None,
        }
    }

    /// Convert one raw output line into zero or more normalized events.
    ///
    /// A line may yield no events (for example a lifecycle marker consumed for
    /// metadata) or several (for example a Codex `file_change` touching multiple
    /// paths).
    pub fn ingest(&mut self, stream: OutputStream, line: &str) -> Vec<HarnessEvent> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }
        match stream {
            // Output on standard error is a harness diagnostic, not agent
            // activity. Surfacing it as a warning is what makes a failing
            // harness's own complaint visible while the run is still in progress.
            OutputStream::Stderr => vec![self.event(EventKind::Warning {
                message: trimmed.to_string(),
                code: None,
            })],
            OutputStream::Stdout => match self.format {
                EventFormat::Codex => self.parse_codex(trimmed),
                EventFormat::Generic => self.parse_generic(trimmed),
            },
        }
    }

    /// Stamp a kind with the current timestamp and session ID.
    fn event(&self, kind: EventKind) -> HarnessEvent {
        HarnessEvent {
            timestamp: now_timestamp(),
            session_id: self.session_id.clone(),
            kind,
        }
    }

    /// Best effort mapping: surface each line so nothing is lost, classifying as
    /// an unknown event carrying the raw JSON value or, failing that, the raw
    /// text.
    fn parse_generic(&self, line: &str) -> Vec<HarnessEvent> {
        let raw =
            serde_json::from_str::<Value>(line).unwrap_or_else(|_| Value::String(line.to_string()));
        vec![self.event(EventKind::Unknown { raw })]
    }

    /// Map one line of Codex's `codex exec --json` JSONL stream.
    fn parse_codex(&mut self, line: &str) -> Vec<HarnessEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            // Codex's event stream is JSON; a non-JSON line is a diagnostic
            // printed outside the stream, so surface it as a warning.
            return vec![self.event(EventKind::Warning {
                message: line.to_string(),
                code: None,
            })];
        };
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "thread.started" => {
                if let Some(id) = value.get("thread_id").and_then(Value::as_str) {
                    self.session_id = Some(id.to_string());
                }
                Vec::new()
            }
            // Turn boundaries and the in-progress half of an item are consumed
            // for metadata; the normalized event is derived from the completed
            // item so terminal information such as an exit code is available.
            "turn.started" | "turn.completed" | "item.started" => Vec::new(),
            "item.completed" => match value.get("item") {
                Some(item) => self.parse_codex_item(item),
                None => vec![self.event(EventKind::Unknown { raw: value })],
            },
            "error" => vec![self.event(EventKind::Error {
                message: string_field(&value, "message", "codex reported an error"),
                code: None,
            })],
            _ => vec![self.event(EventKind::Unknown { raw: value })],
        }
    }

    /// Map a completed Codex `item` to its normalized event(s).
    fn parse_codex_item(&self, item: &Value) -> Vec<HarnessEvent> {
        let exit_code = item
            .get("exit_code")
            .and_then(Value::as_i64)
            .map(|code| code as i32);
        let is_success = exit_code.map(|code| code == 0);
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "command_execution" => {
                let command = string_field(item, "command", "");
                vec![self.event(classify_command(&command, exit_code, is_success))]
            }
            "file_change" => match item.get("changes").and_then(Value::as_array) {
                Some(changes) if !changes.is_empty() => changes
                    .iter()
                    .map(|change| {
                        self.event(EventKind::Write {
                            path: string_field(change, "path", ""),
                            start_line: None,
                            end_line: None,
                            is_success: Some(true),
                        })
                    })
                    .collect(),
                _ => vec![self.event(EventKind::Unknown { raw: item.clone() })],
            },
            "agent_message" => vec![self.event(EventKind::Agent {
                message: string_field(item, "text", ""),
            })],
            "error" => vec![self.event(EventKind::Error {
                message: string_field(item, "message", "codex reported an error"),
                code: None,
            })],
            _ => vec![self.event(EventKind::Unknown { raw: item.clone() })],
        }
    }
}

/// The current time as an RFC 3339 / ISO 8601 string.
fn now_timestamp() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Read a string field from a JSON object, falling back to `default`.
fn string_field(value: &Value, key: &str, default: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or(default)
        .to_string()
}

/// Classify a shell command into a file operation event when it is recognizably
/// one, otherwise a plain command event.
fn classify_command(command: &str, exit_code: Option<i32>, is_success: Option<bool>) -> EventKind {
    if let Some(operation) = classify_file_operation(command, is_success) {
        return operation;
    }
    EventKind::Command {
        command: command.to_string(),
        working_directory: None,
        exit_code,
        is_success,
    }
}

/// Recognize a command as a file read, search, or directory listing.
///
/// Only the first simple command is considered, and only commands that are
/// confidently a file operation are reclassified; anything ambiguous stays a
/// command event by returning `None`.
fn classify_file_operation(command: &str, is_success: Option<bool>) -> Option<EventKind> {
    let simple = first_simple_command(command);
    let base = simple.first()?.rsplit('/').next().unwrap_or_default();
    match base {
        "cat" => Some(EventKind::Read {
            path: last_path(&simple)?,
            start_line: None,
            end_line: None,
            is_success,
        }),
        "sed" => sed_read(&simple, is_success),
        "rg" | "grep" | "find" => Some(EventKind::Search {
            query: search_query(&simple)?,
            path: None,
            is_success,
        }),
        "ls" => Some(EventKind::List {
            path: last_path(&simple),
            is_success,
        }),
        _ => None,
    }
}

/// Map a print-only `sed` invocation such as `sed -n '10,20p' path` to a read
/// event, extracting the line range. Anything that is not clearly a print range
/// stays a command event.
fn sed_read(tokens: &[String], is_success: Option<bool>) -> Option<EventKind> {
    // Only `-n` print ranges are treated as reads; sed without `-n` may be
    // editing in place, which is not a read.
    if !tokens.iter().any(|token| token == "-n") {
        return None;
    }
    let (start_line, end_line) = tokens.iter().find_map(|token| parse_sed_range(token))?;
    let path = last_path(tokens)?;
    Some(EventKind::Read {
        path,
        start_line,
        end_line,
        is_success,
    })
}

/// Parse a `sed` print range such as `10,20p` or `5p` into start/end lines.
fn parse_sed_range(token: &str) -> Option<(Option<u32>, Option<u32>)> {
    let range = token.strip_suffix('p')?;
    match range.split_once(',') {
        Some((start, end)) => Some((start.parse().ok(), end.parse().ok())),
        None => {
            let line: u32 = range.parse().ok()?;
            Some((Some(line), Some(line)))
        }
    }
}

/// The last token that is not an option flag, used as the operand path.
fn last_path(tokens: &[String]) -> Option<String> {
    tokens
        .iter()
        .skip(1)
        .rfind(|token| !token.starts_with('-') && parse_sed_range(token).is_none())
        .cloned()
}

/// The first non-flag operand, used as a search query.
fn search_query(tokens: &[String]) -> Option<String> {
    tokens
        .iter()
        .skip(1)
        .find(|token| !token.starts_with('-'))
        .cloned()
}

/// Extract the first simple command of a shell invocation, unwrapping a
/// `bash -lc "<script>"` wrapper and stopping at the first shell operator.
fn first_simple_command(command: &str) -> Vec<String> {
    let tokens = shell_split(command);
    let script_tokens = match bash_script_token(&tokens) {
        Some(script) => shell_split(script),
        None => tokens,
    };
    script_tokens
        .into_iter()
        .take_while(|token| !is_operator(token))
        .collect()
}

/// If the command is a `bash`/`sh` `-c`/`-lc` invocation, return the script it
/// was asked to run.
fn bash_script_token(tokens: &[String]) -> Option<&str> {
    let program = tokens.first()?.rsplit('/').next().unwrap_or_default();
    if program != "bash" && program != "sh" {
        return None;
    }
    let flag = tokens
        .iter()
        .position(|token| token == "-lc" || token == "-c")?;
    tokens.get(flag + 1).map(String::as_str)
}

/// Whether a token is a shell control operator that ends a simple command.
fn is_operator(token: &str) -> bool {
    matches!(token, "&&" | "||" | ";" | "|" | "&")
}

/// Split a shell command into tokens, respecting single and double quotes.
fn shell_split(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut has_token = false;
    let mut in_single = false;
    let mut in_double = false;
    for ch in input.chars() {
        match ch {
            '\'' if !in_double => {
                in_single = !in_single;
                has_token = true;
            }
            '"' if !in_single => {
                in_double = !in_double;
                has_token = true;
            }
            ch if ch.is_whitespace() && !in_single && !in_double => {
                if has_token {
                    tokens.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            ch => {
                current.push(ch);
                has_token = true;
            }
        }
    }
    if has_token {
        tokens.push(current);
    }
    tokens
}

#[cfg(test)]
#[path = "event.test.rs"]
mod tests;
