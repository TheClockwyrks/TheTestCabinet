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
    /// Claude Code's `claude --print --output-format stream-json` JSONL stream,
    /// mapped per `docs/events.md`.
    Claude,
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
    /// Claude tool uses seen in `assistant` events, awaiting the matching
    /// tool-result in a later `user` event. Empty for other formats.
    claude_tool_uses: Vec<ClaudeToolUse>,
    /// The Claude session working directory, captured from the `system` init
    /// event, used to resolve relative paths to absolute ones. Unset for other
    /// formats and until the init event is seen.
    claude_workspace: Option<String>,
}

impl EventParser {
    /// Create a parser for the given harness output format.
    pub fn new(format: EventFormat) -> Self {
        Self {
            format,
            session_id: None,
            claude_tool_uses: Vec::new(),
            claude_workspace: None,
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
                EventFormat::Claude => self.parse_claude(trimmed),
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

    /// Map one line of Claude Code's `--output-format stream-json` JSONL stream.
    ///
    /// The stream is stateful: `assistant` events introduce tool uses that are
    /// only resolved into a normalized event once the matching `user`
    /// tool-result arrives, so the operation requested by the agent is paired
    /// with its observed success.
    fn parse_claude(&mut self, line: &str) -> Vec<HarnessEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            // Claude Code's stream is JSON; a non-JSON line is a diagnostic
            // printed outside the stream, so surface it as a warning.
            return vec![self.event(EventKind::Warning {
                message: line.to_string(),
                code: None,
            })];
        };
        // Any event may carry the session ID; capture the first non-empty one.
        if self.session_id.is_none()
            && let Some(id) = value.get("session_id").and_then(Value::as_str)
            && !id.is_empty()
        {
            self.session_id = Some(id.to_string());
        }
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "system" => self.parse_claude_system(&value),
            "assistant" => self.parse_claude_assistant(&value),
            "user" => self.parse_claude_user(&value),
            "rate_limit_event" => self.parse_claude_rate_limit(&value),
            "result" => self.parse_claude_result(&value),
            // Lower-level stream telemetry restates the completed assistant and
            // user events with less reliable partial data, so it is consumed.
            "stream_event" => Vec::new(),
            _ => vec![self.event(EventKind::Unknown { raw: value })],
        }
    }

    /// Handle a Claude `system` event: session lifecycle metadata, not activity.
    fn parse_claude_system(&mut self, value: &Value) -> Vec<HarnessEvent> {
        // The init event reports the working directory; capture it so relative
        // paths (such as a synthesized skill file) resolve to absolute ones.
        if let Some(cwd) = value.get("cwd").and_then(Value::as_str)
            && !cwd.is_empty()
        {
            self.claude_workspace = Some(cwd.to_string());
        }
        match value.get("subtype").and_then(Value::as_str) {
            Some("init" | "status" | "thinking_tokens") => Vec::new(),
            // A system subtype with no defined mapping is surfaced verbatim.
            _ => vec![self.event(EventKind::Unknown { raw: value.clone() })],
        }
    }

    /// Handle a Claude `assistant` event: text becomes an agent message and tool
    /// uses are recorded for correlation with their later tool-result.
    fn parse_claude_assistant(&mut self, value: &Value) -> Vec<HarnessEvent> {
        let Some(content) = value
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
        else {
            return vec![self.event(EventKind::Unknown { raw: value.clone() })];
        };
        let workspace = self.claude_workspace.clone();
        let mut events = Vec::new();
        // Text blocks within one message are one logical message; join them so a
        // message split across blocks is reported as a single agent event.
        let message: String = content.iter().filter_map(claude_text_block).collect();
        if !message.is_empty() {
            events.push(self.event(EventKind::Agent { message }));
        }
        for block in content {
            match block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                // Already handled above, or model reasoning that is not activity.
                "text" | "thinking" | "redacted_thinking" => {}
                "tool_use" => match ClaudeToolUse::from_block(block, workspace.as_deref()) {
                    // A recognized tool: record it and wait for its result.
                    Some(tool_use) => self.claude_tool_uses.push(tool_use),
                    // An unrecognized or malformed tool use is surfaced verbatim.
                    None => events.push(self.event(EventKind::Unknown { raw: block.clone() })),
                },
                _ => events.push(self.event(EventKind::Unknown { raw: block.clone() })),
            }
        }
        events
    }

    /// Handle a Claude `user` event: tool results resolve a recorded tool use,
    /// while echoed prompt text carries no activity.
    fn parse_claude_user(&mut self, value: &Value) -> Vec<HarnessEvent> {
        let Some(content) = value
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_array)
        else {
            return vec![self.event(EventKind::Unknown { raw: value.clone() })];
        };
        let mut events = Vec::new();
        for block in content {
            match block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "tool_result" => events.extend(self.parse_claude_tool_result(block)),
                // Plain user text is the prompt, or harness-injected context such
                // as an expanded skill, echoed back; it is not agent activity.
                "text" => {}
                _ => events.push(self.event(EventKind::Unknown { raw: block.clone() })),
            }
        }
        events
    }

    /// Resolve a Claude `tool_result` block into its normalized event(s) by
    /// pairing it with the tool use it answers.
    fn parse_claude_tool_result(&mut self, block: &Value) -> Vec<HarnessEvent> {
        let success = claude_tool_result_success(block);
        if let Some(id) = block.get("tool_use_id").and_then(Value::as_str) {
            // Match on a unique id so colliding ids never pair the wrong
            // operation; an ambiguous match is surfaced rather than guessed.
            let matches: Vec<usize> = self
                .claude_tool_uses
                .iter()
                .enumerate()
                .filter(|(_, tool_use)| tool_use.id == id)
                .map(|(index, _)| index)
                .collect();
            if matches.len() == 1 {
                let tool_use = self.claude_tool_uses.remove(matches[0]);
                let workspace = self.claude_workspace.clone();
                return tool_use
                    .operation
                    .into_event_kinds(success, workspace.as_deref())
                    .into_iter()
                    .map(|kind| self.event(kind))
                    .collect();
            }
            if !matches.is_empty() {
                return vec![self.event(EventKind::Unknown { raw: block.clone() })];
            }
        }
        // No matching tool use: a read result still names the file it read, so
        // it can be recovered even when its tool use was not captured.
        if let Some(kind) =
            claude_read_result_fallback(block, success, self.claude_workspace.as_deref())
        {
            return vec![self.event(kind)];
        }
        vec![self.event(EventKind::Unknown { raw: block.clone() })]
    }

    /// Handle a Claude `rate_limit_event`: credential state, not activity, unless
    /// the credential is limited in a way that warrants a warning.
    fn parse_claude_rate_limit(&self, value: &Value) -> Vec<HarnessEvent> {
        match value
            .pointer("/rate_limit_info/status")
            .and_then(Value::as_str)
        {
            // The credential is usable; this is just reported state.
            Some("allowed") | None => Vec::new(),
            Some(status) => vec![self.event(EventKind::Warning {
                message: format!("claude code rate limit status: {status}"),
                code: None,
            })],
        }
    }

    /// Handle the Claude terminal `result` event. Its usage and final output are
    /// consumed elsewhere; only a terminal error needs to surface as an event.
    fn parse_claude_result(&self, value: &Value) -> Vec<HarnessEvent> {
        if claude_result_is_error(value) {
            return vec![self.event(EventKind::Error {
                message: claude_result_error_message(value),
                code: None,
            })];
        }
        Vec::new()
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

/// A Claude tool use recorded from an `assistant` event, awaiting the
/// tool-result that resolves it into a normalized event.
#[derive(Debug, Clone)]
struct ClaudeToolUse {
    /// The tool-use id a later tool-result references as `tool_use_id`.
    id: String,
    /// The operation the agent requested, recognized from the tool name+input.
    operation: ClaudeToolOperation,
}

impl ClaudeToolUse {
    /// Build a tool use from an `assistant` content block, returning `None` when
    /// the block is not a recognizable tool use (not a `tool_use`, missing
    /// id/name/input, or naming a tool with no normalized mapping). Such blocks
    /// are surfaced as unknown events by the caller.
    fn from_block(block: &Value, workspace: Option<&str>) -> Option<Self> {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            return None;
        }
        let id = block.get("id").and_then(Value::as_str)?.to_string();
        let name = block.get("name").and_then(Value::as_str)?;
        let input = block.get("input")?;
        let operation = ClaudeToolOperation::from_input(name, input, workspace)?;
        Some(Self { id, operation })
    }
}

/// The operation a recognized Claude tool use requested. Bash is kept as its raw
/// command and classified into a read/search/list/command at result time, when
/// its success is known, by the same logic Codex commands use.
#[derive(Debug, Clone)]
enum ClaudeToolOperation {
    Read {
        path: String,
        start_line: Option<u32>,
        end_line: Option<u32>,
    },
    Write {
        path: String,
    },
    Search {
        query: String,
        path: Option<String>,
    },
    List {
        path: Option<String>,
    },
    Bash {
        command: String,
    },
    Skill {
        name: String,
    },
    /// Native delivery of `--json-schema` output; produces no activity event.
    StructuredOutput,
}

impl ClaudeToolOperation {
    /// Recognize the operation from a tool name and its input, returning `None`
    /// for tools that have no normalized mapping (MCP tools, web tools, todo
    /// tools, and the like) so the caller can surface them as unknown.
    fn from_input(name: &str, input: &Value, workspace: Option<&str>) -> Option<Self> {
        match name {
            "Read" => {
                let path = lookup_str(input, &["file_path", "path"])?;
                let start_line = lookup_u32(input, &["offset", "start_line"]);
                // Claude reports a starting offset and a line count, so the
                // inclusive end is `offset + limit - 1` when both are present.
                let end_line = start_line.and_then(|start| {
                    lookup_u32(input, &["limit", "line_count"])
                        .map(|limit| start.saturating_add(limit).saturating_sub(1))
                });
                Some(Self::Read {
                    path: normalize_claude_path(path, workspace),
                    start_line,
                    end_line,
                })
            }
            "Write" | "Edit" | "MultiEdit" => Some(Self::Write {
                path: normalize_claude_path(
                    lookup_str(input, &["file_path", "filePath", "path"])?,
                    workspace,
                ),
            }),
            "NotebookEdit" => Some(Self::Write {
                path: normalize_claude_path(
                    lookup_str(
                        input,
                        &[
                            "notebook_path",
                            "notebookPath",
                            "file_path",
                            "filePath",
                            "path",
                        ],
                    )?,
                    workspace,
                ),
            }),
            "Grep" => Some(Self::Search {
                query: lookup_str(input, &["pattern", "query"])?.to_string(),
                path: input
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| normalize_claude_path(path, workspace)),
            }),
            "Glob" => Some(Self::Search {
                query: lookup_str(input, &["pattern", "glob"])?.to_string(),
                path: input
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| normalize_claude_path(path, workspace)),
            }),
            "LS" => Some(Self::List {
                path: input
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| normalize_claude_path(path, workspace)),
            }),
            "Bash" => Some(Self::Bash {
                command: lookup_str(input, &["command", "cmd"])?.to_string(),
            }),
            "Skill" => Some(Self::Skill {
                name: lookup_str(input, &["skill", "skill_name", "command"])?.to_string(),
            }),
            "StructuredOutput" => Some(Self::StructuredOutput),
            _ => None,
        }
    }

    /// Resolve the operation into its normalized event(s), now that the
    /// tool-result has reported whether it succeeded.
    fn into_event_kinds(self, success: bool, workspace: Option<&str>) -> Vec<EventKind> {
        match self {
            Self::Read {
                path,
                start_line,
                end_line,
            } => vec![EventKind::Read {
                path,
                start_line,
                end_line,
                is_success: Some(success),
            }],
            Self::Write { path } => vec![EventKind::Write {
                path,
                start_line: None,
                end_line: None,
                is_success: Some(success),
            }],
            Self::Search { query, path } => vec![EventKind::Search {
                query,
                path,
                is_success: Some(success),
            }],
            Self::List { path } => vec![EventKind::List {
                path,
                is_success: Some(success),
            }],
            // A shell command is classified like Codex's: a recognized file
            // operation becomes the matching event, anything else a command.
            // Claude does not report a stable exit code for Bash results.
            Self::Bash { command } => vec![classify_command(&command, None, Some(success))],
            Self::Skill { name } => {
                let path = normalize_claude_path(&format!("skills/{name}/SKILL.md"), workspace);
                vec![EventKind::Skill {
                    path,
                    skill_name: Some(name),
                    start_line: None,
                    end_line: None,
                    is_success: Some(success),
                }]
            }
            // The native StructuredOutput tool is delivery plumbing; its payload
            // surfaces through the terminal result, not as an activity event.
            Self::StructuredOutput => Vec::new(),
        }
    }
}

/// The text of a Claude `text` content block, if the block is one and non-empty.
fn claude_text_block(block: &Value) -> Option<&str> {
    if block.get("type").and_then(Value::as_str) != Some("text") {
        return None;
    }
    block
        .get("text")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// Whether a Claude tool-result reports success: a result is a failure only when
/// it is flagged as an error or as interrupted.
fn claude_tool_result_success(block: &Value) -> bool {
    let is_error = block
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let interrupted = ["is_interruption", "is_interrupted", "interrupted"]
        .iter()
        .any(|key| block.get(*key).and_then(Value::as_bool).unwrap_or(false));
    !is_error && !interrupted
}

/// Recover a read event from a tool-result that has no matching recorded tool
/// use, using the file metadata Claude attaches to a `Read` result.
fn claude_read_result_fallback(
    block: &Value,
    success: bool,
    workspace: Option<&str>,
) -> Option<EventKind> {
    let file = block
        .get("tool_use_result")
        .and_then(|result| result.get("file"))?;
    let path =
        lookup_str(file, &["file_path", "filePath", "path"]).filter(|path| !path.is_empty())?;
    Some(EventKind::Read {
        path: normalize_claude_path(path, workspace),
        start_line: lookup_u32(file, &["start_line", "startLine", "offset"])
            .filter(|line| *line > 0),
        end_line: None,
        is_success: Some(success),
    })
}

/// Whether a Claude terminal `result` event reports an error: an error flag, a
/// non-success subtype, or an API error status all indicate a harness error.
fn claude_result_is_error(value: &Value) -> bool {
    value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || value
            .get("subtype")
            .and_then(Value::as_str)
            .is_some_and(|subtype| subtype != "success")
        || value.get("api_error_status").is_some()
}

/// Summarize the error a Claude terminal `result` event reports.
fn claude_result_error_message(value: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(subtype) = value.get("subtype").and_then(Value::as_str)
        && subtype != "success"
    {
        parts.push(format!("subtype={subtype}"));
    }
    if value
        .get("is_error")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        parts.push("is_error=true".to_string());
    }
    if let Some(status) = value.get("api_error_status") {
        parts.push(format!("api_error_status={status}"));
    }
    if parts.is_empty() {
        "claude code reported a terminal error".to_string()
    } else {
        format!(
            "claude code reported a terminal error: {}",
            parts.join(", ")
        )
    }
}

/// The first present string among `keys` in a JSON object.
fn lookup_str<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
}

/// The first present `u32` among `keys` in a JSON object.
fn lookup_u32(value: &Value, keys: &[&str]) -> Option<u32> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_u64)
            .and_then(|number| u32::try_from(number).ok())
    })
}

/// Resolve a Claude path to an absolute, `.`/`..`-collapsed form. An absolute
/// path is normalized in place; a relative path is joined onto the workspace
/// when one is known and otherwise surfaced as written.
fn normalize_claude_path(path: &str, workspace: Option<&str>) -> String {
    use std::path::{Component, Path, PathBuf};
    let raw = Path::new(path);
    let candidate = if raw.is_absolute() {
        raw.to_path_buf()
    } else if let Some(workspace) = workspace {
        Path::new(workspace).join(raw)
    } else {
        return path.to_string();
    };
    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized.display().to_string()
}

#[cfg(test)]
#[path = "event.test.rs"]
mod tests;
