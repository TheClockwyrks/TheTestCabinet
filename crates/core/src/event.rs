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

impl HarnessEvent {
    /// Build a [system lifecycle event](EventKind::System) for `stage` at
    /// `status`, stamped with the current time and carrying the stage's default
    /// description as its message.
    ///
    /// Unlike every other event these originate in the orchestrator rather than
    /// being translated from harness output, so they carry no harness session
    /// id. They report the setup and teardown work around a harness session so a
    /// caller sees progress during steps that can take a while instead of a
    /// silent wait before the harness produces its first event.
    pub fn system(stage: SystemStage, status: SystemStatus) -> Self {
        HarnessEvent {
            timestamp: now_timestamp(),
            session_id: None,
            kind: EventKind::System {
                stage,
                status,
                message: stage.describe(status),
            },
        }
    }
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
    /// A run lifecycle stage reported by the orchestrator itself, rather than
    /// translated from harness output. These mark the setup and teardown steps
    /// that bracket a harness session — pulling the image, starting the
    /// container, installing the harness, preparing the test case, and tearing
    /// down — so a caller sees what is happening during steps that can take a
    /// while instead of a silent wait before the harness's first event.
    System {
        /// The setup or teardown stage this event reports on.
        stage: SystemStage,
        /// Whether the stage is beginning, finished, or failed.
        status: SystemStatus,
        /// A human readable description of the stage and its status.
        message: String,
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

/// The setup and teardown stages of a run that the orchestrator reports as
/// [`EventKind::System`] events, in the order they occur around a harness
/// session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemStage {
    /// Pulling the run-container image.
    PullImage,
    /// Starting the run container.
    StartContainer,
    /// Installing the harness's CLI into the running container.
    InstallHarness,
    /// Confirming the installed harness CLI is usable.
    ProbeHarness,
    /// Running the test case's init command to prepare the workspace.
    InitTestCase,
    /// Collecting artifacts and stopping the container after the session.
    Teardown,
}

/// The point a [`SystemStage`] has reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SystemStatus {
    /// The stage has begun.
    Started,
    /// The stage finished successfully.
    Completed,
    /// The stage failed; the run will not proceed past it.
    Failed,
}

impl SystemStage {
    /// A human readable description of this stage at the given status, used as
    /// the default message for a [system event](HarnessEvent::system).
    fn describe(self, status: SystemStatus) -> String {
        use SystemStage::*;
        use SystemStatus::*;
        let phrase = match (self, status) {
            (PullImage, Started) => "Pulling the run-container image",
            (PullImage, Completed) => "Run-container image ready",
            (PullImage, Failed) => "Failed to pull the run-container image",
            (StartContainer, Started) => "Starting the run container",
            (StartContainer, Completed) => "Run container started",
            (StartContainer, Failed) => "Failed to start the run container",
            (InstallHarness, Started) => "Installing the harness CLI",
            (InstallHarness, Completed) => "Harness CLI installed",
            (InstallHarness, Failed) => "Failed to install the harness CLI",
            (ProbeHarness, Started) => "Checking the harness is ready",
            (ProbeHarness, Completed) => "Harness ready",
            (ProbeHarness, Failed) => "Harness is unavailable",
            (InitTestCase, Started) => "Preparing the test case workspace",
            (InitTestCase, Completed) => "Test case workspace ready",
            (InitTestCase, Failed) => "Failed to prepare the test case workspace",
            (Teardown, Started) => "Tearing down the run container",
            (Teardown, Completed) => "Run container torn down",
            (Teardown, Failed) => "Failed to tear down the run container",
        };
        phrase.to_string()
    }
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
    /// Cline's `cline --json` JSONL stream, mapped per `docs/events.md`.
    Cline,
    /// Goose's `goose run --output-format stream-json` JSONL stream, mapped per
    /// `docs/events.md`.
    Goose,
    /// Kilo Code's `kilo run --format json` JSONL stream, mapped per
    /// `docs/events.md`.
    Kilo,
    /// OpenCode's `opencode run --format json` JSONL stream, mapped per
    /// `docs/events.md`.
    Opencode,
    /// Pi's `pi --mode json --print` JSONL stream, mapped per `docs/events.md`.
    Pi,
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
    /// Tool calls recorded from a request event, awaiting the response that
    /// resolves them, for harnesses that split a call across two events (Cline,
    /// Goose). Empty for other formats.
    pending_tools: Vec<PendingTool>,
    /// Accumulated Goose assistant text for the in-progress message, as
    /// `(message id, text)`, flushed as an agent event when activity follows or
    /// the run completes. Goose streams a message as cumulative-or-delta records
    /// sharing one id, so the fragments are joined rather than emitted each.
    goose_pending: Option<(String, String)>,
    /// The session working directory used to resolve relative paths to absolute
    /// ones, captured from a harness's session/init event. Unset until seen.
    workspace: Option<String>,
}

impl EventParser {
    /// Create a parser for the given harness output format.
    pub fn new(format: EventFormat) -> Self {
        Self {
            format,
            session_id: None,
            claude_tool_uses: Vec::new(),
            pending_tools: Vec::new(),
            goose_pending: None,
            workspace: None,
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
                EventFormat::Cline => self.parse_cline(trimmed),
                EventFormat::Goose => self.parse_goose(trimmed),
                EventFormat::Kilo => self.parse_kilo(trimmed),
                EventFormat::Opencode => self.parse_opencode(trimmed),
                EventFormat::Pi => self.parse_pi(trimmed),
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
            self.workspace = Some(cwd.to_string());
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
        let workspace = self.workspace.clone();
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
                let workspace = self.workspace.clone();
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
        if let Some(kind) = claude_read_result_fallback(block, success, self.workspace.as_deref()) {
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

    /// Capture the first non-empty session id seen under any of `keys`.
    fn capture_session(&mut self, value: &Value, keys: &[&str]) {
        if self.session_id.is_none()
            && let Some(id) = lookup_str(value, keys).filter(|id| !id.is_empty())
        {
            self.session_id = Some(id.to_string());
        }
    }

    /// Decode a JSONL stdout line, surfacing a non-JSON line as a warning since
    /// these harnesses emit a JSON stream and a bare line is a diagnostic.
    fn json_line(&self, line: &str) -> std::result::Result<Value, Vec<HarnessEvent>> {
        serde_json::from_str::<Value>(line).map_err(|_| {
            vec![self.event(EventKind::Warning {
                message: line.to_string(),
                code: None,
            })]
        })
    }

    /// Resolve a tool call recorded earlier against the response now arriving,
    /// matching on a unique id. The `classify` closure maps the recorded tool to
    /// its normalized event kinds; an unmatched or unclassifiable response is
    /// surfaced verbatim so the stream stays lossless.
    fn resolve_pending_tool(
        &mut self,
        id: Option<&str>,
        is_success: Option<bool>,
        raw: &Value,
        classify: ToolClassifier,
    ) -> Vec<HarnessEvent> {
        if let Some(id) = id
            && let Some(position) = self.pending_tools.iter().position(|tool| tool.id == id)
        {
            let tool = self.pending_tools.remove(position);
            let workspace = self.workspace.clone();
            return match classify(&tool.name, &tool.input, is_success, workspace.as_deref()) {
                Some(kinds) => kinds.into_iter().map(|kind| self.event(kind)).collect(),
                None => vec![self.event(EventKind::Unknown { raw: raw.clone() })],
            };
        }
        vec![self.event(EventKind::Unknown { raw: raw.clone() })]
    }

    /// Map one line of Cline's `cline --json` JSONL stream.
    fn parse_cline(&mut self, line: &str) -> Vec<HarnessEvent> {
        let value = match self.json_line(line) {
            Ok(value) => value,
            Err(events) => return events,
        };
        // `taskId`/`task_id` name the in-memory conversation, not the session, so
        // only the dedicated session fields are captured.
        self.capture_session(&value, &["sessionId", "session_id", "id"]);
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            // Hook bookkeeping and the terminal record (its text and usage are
            // consumed elsewhere) carry no agent activity.
            "hook_event" | "run_result" => Vec::new(),
            "agent_event" => self.parse_cline_agent_event(&value),
            // Older Cline versions emit a flat say/ask stream.
            _ => self.parse_cline_legacy(&value),
        }
    }

    /// Handle a Cline `agent_event`, whose real event is nested in `event`.
    fn parse_cline_agent_event(&mut self, value: &Value) -> Vec<HarnessEvent> {
        let Some(inner) = value.get("event") else {
            return vec![self.event(EventKind::Unknown { raw: value.clone() })];
        };
        let inner_type = inner
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let content_type = inner
            .get("contentType")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match inner_type {
            // Iteration boundaries, per-step usage, and completion are consumed;
            // totals come from the `run_result` record instead.
            "iteration_start" | "iteration_end" | "usage" | "done" => Vec::new(),
            // A tool's input arrives on content_start; the streaming text delta
            // is consumed because content_end carries the complete text.
            "content_start" => {
                if content_type == "tool" {
                    self.record_cline_tool(inner);
                }
                Vec::new()
            }
            "content_end" => match content_type {
                "text" => match inner
                    .get("text")
                    .or_else(|| inner.get("content"))
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                {
                    Some(text) => vec![self.event(EventKind::Agent {
                        message: text.to_string(),
                    })],
                    None => Vec::new(),
                },
                "tool" => self.complete_cline_tool(inner),
                _ => vec![self.event(EventKind::Unknown { raw: inner.clone() })],
            },
            _ => vec![self.event(EventKind::Unknown { raw: inner.clone() })],
        }
    }

    /// Record a Cline tool call's input from its content_start so the matching
    /// content_end can resolve it with the tool's terminal success.
    fn record_cline_tool(&mut self, inner: &Value) {
        let id = inner.get("toolCallId").and_then(Value::as_str);
        let name = inner.get("toolName").and_then(Value::as_str);
        if let (Some(id), Some(name)) = (id, name) {
            self.pending_tools.push(PendingTool {
                id: id.to_string(),
                name: name.to_string(),
                input: inner.get("input").cloned().unwrap_or(Value::Null),
            });
        }
    }

    /// Resolve a Cline tool call's content_end into its normalized event(s).
    fn complete_cline_tool(&mut self, inner: &Value) -> Vec<HarnessEvent> {
        let success = cline_tool_success(inner.get("output"));
        let id = inner.get("toolCallId").and_then(Value::as_str);
        // The content_end may also restate the name and input, so a call whose
        // start was missed can still be classified from this record alone.
        let unmatched = id.is_none()
            || !self
                .pending_tools
                .iter()
                .any(|tool| Some(tool.id.as_str()) == id);
        if unmatched && let Some(name) = inner.get("toolName").and_then(Value::as_str) {
            let input = inner.get("input").cloned().unwrap_or(Value::Null);
            let workspace = self.workspace.clone();
            return match classify_cline_tool(name, &input, success, workspace.as_deref()) {
                Some(kinds) => kinds.into_iter().map(|kind| self.event(kind)).collect(),
                None => vec![self.event(EventKind::Unknown { raw: inner.clone() })],
            };
        }
        self.resolve_pending_tool(id, success, inner, classify_cline_tool)
    }

    /// Handle the legacy flat say/ask stream older Cline versions emit. Tool
    /// activity in that stream is not reconstructed; only prose is mapped, and
    /// anything ambiguous is surfaced verbatim.
    fn parse_cline_legacy(&self, value: &Value) -> Vec<HarnessEvent> {
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "say" => match value.get("say").and_then(Value::as_str).unwrap_or_default() {
                "text" | "completion_result" => self.cline_legacy_text(value),
                // Reasoning is model thinking, not agent progress.
                "reasoning" => Vec::new(),
                "error" | "api_req_failed" => vec![self.event(EventKind::Error {
                    message: string_field(value, "text", "cline reported an error"),
                    code: None,
                })],
                _ => vec![self.event(EventKind::Unknown { raw: value.clone() })],
            },
            "ask" => match value.get("ask").and_then(Value::as_str).unwrap_or_default() {
                "followup" => self.cline_legacy_text(value),
                _ => vec![self.event(EventKind::Unknown { raw: value.clone() })],
            },
            _ => vec![self.event(EventKind::Unknown { raw: value.clone() })],
        }
    }

    /// Emit a legacy say/ask message's prose as an agent event, when present.
    fn cline_legacy_text(&self, value: &Value) -> Vec<HarnessEvent> {
        match value
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            Some(text) => vec![self.event(EventKind::Agent {
                message: text.to_string(),
            })],
            None => Vec::new(),
        }
    }

    /// Map one line of Goose's `goose run --output-format stream-json` stream.
    fn parse_goose(&mut self, line: &str) -> Vec<HarnessEvent> {
        let value = match self.json_line(line) {
            Ok(value) => value,
            Err(events) => return events,
        };
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "message" => self.parse_goose_message(&value),
            "notification" => self.parse_goose_notification(&value),
            "error" => {
                let mut events = Vec::new();
                self.flush_goose_text(&mut events);
                events.push(self.event(EventKind::Error {
                    message: harness_error_message(&value, "goose reported an error"),
                    code: None,
                }));
                events
            }
            // The run boundary carries usage, consumed elsewhere; flush the final
            // assistant text so it is not lost.
            "complete" => {
                let mut events = Vec::new();
                self.flush_goose_text(&mut events);
                events
            }
            _ => {
                let mut events = Vec::new();
                self.flush_goose_text(&mut events);
                events.push(self.event(EventKind::Unknown { raw: value.clone() }));
                events
            }
        }
    }

    /// Process a Goose `message` event's content blocks in order.
    fn parse_goose_message(&mut self, value: &Value) -> Vec<HarnessEvent> {
        let Some(message) = value.get("message") else {
            return vec![self.event(EventKind::Unknown { raw: value.clone() })];
        };
        let role = message.get("role").and_then(Value::as_str);
        let id = dig(value, &[&["id"], &["message", "id"]])
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let Some(content) = message.get("content").and_then(Value::as_array) else {
            return Vec::new();
        };
        let mut events = Vec::new();
        for block in content {
            match block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "text" => {
                    // Only assistant text is agent progress; user text is the
                    // echoed prompt.
                    if role == Some("assistant")
                        && let Some(text) = block
                            .get("text")
                            .and_then(Value::as_str)
                            .filter(|t| !t.is_empty())
                    {
                        self.push_goose_text(&id, text, &mut events);
                    }
                }
                "thinking" | "redactedThinking" => {}
                "toolRequest" => {
                    self.flush_goose_text(&mut events);
                    match goose_tool_request(block) {
                        Some(tool) => self.pending_tools.push(tool),
                        None => events.push(self.event(EventKind::Unknown { raw: block.clone() })),
                    }
                }
                "toolResponse" => {
                    self.flush_goose_text(&mut events);
                    let id = goose_tool_id(block, "toolResponse");
                    let success = goose_response_success(block);
                    events.extend(self.resolve_pending_tool(
                        id.as_deref(),
                        success,
                        block,
                        classify_goose_tool,
                    ));
                }
                _ => events.push(self.event(EventKind::Unknown { raw: block.clone() })),
            }
        }
        events
    }

    /// Accumulate a Goose assistant text fragment into the pending message,
    /// flushing the previous message first when the id changes.
    fn push_goose_text(&mut self, id: &str, text: &str, events: &mut Vec<HarnessEvent>) {
        if let Some((pending_id, pending_text)) = &mut self.goose_pending
            && pending_id == id
        {
            // A record that restates the pending text is a cumulative update; any
            // other same-id record is a delta whose fragment is appended.
            if text.starts_with(pending_text.as_str()) {
                *pending_text = text.to_string();
            } else {
                pending_text.push_str(text);
            }
            return;
        }
        self.flush_goose_text(events);
        self.goose_pending = Some((id.to_string(), text.to_string()));
    }

    /// Emit the pending Goose assistant text as an agent event, if any.
    fn flush_goose_text(&mut self, events: &mut Vec<HarnessEvent>) {
        if let Some((_, text)) = self.goose_pending.take() {
            events.push(self.event(EventKind::Agent { message: text }));
        }
    }

    /// Map a Goose `notification`: structured subagent logs become orchestration
    /// and everything else is surfaced verbatim rather than parsed from prose.
    fn parse_goose_notification(&self, value: &Value) -> Vec<HarnessEvent> {
        vec![self.event(EventKind::Unknown { raw: value.clone() })]
    }

    /// Map one line of Kilo Code's `kilo run --format json` stream.
    fn parse_kilo(&mut self, line: &str) -> Vec<HarnessEvent> {
        self.parse_step_stream(line, classify_kilo_tool)
    }

    /// Map one line of OpenCode's `opencode run --format json` stream.
    fn parse_opencode(&mut self, line: &str) -> Vec<HarnessEvent> {
        self.parse_step_stream(line, classify_opencode_tool)
    }

    /// Map one line of an OpenCode-style step stream (shared by OpenCode and the
    /// Kilo Code runtime built on it). Tool events are self-contained, so each is
    /// classified in place by the supplied `classify` rather than correlated.
    fn parse_step_stream(&mut self, line: &str, classify: ToolClassifier) -> Vec<HarnessEvent> {
        let value = match self.json_line(line) {
            Ok(value) => value,
            Err(events) => return events,
        };
        self.capture_session(&value, &["sessionID", "session_id", "sessionId"]);
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            // Step boundaries carry usage, and reasoning is model thinking.
            "step_start" | "step_finish" | "reasoning" => Vec::new(),
            "text" => match dig(&value, &[&["part", "text"], &["text"]])
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
            {
                Some(text) => vec![self.event(EventKind::Agent {
                    message: text.to_string(),
                })],
                None => Vec::new(),
            },
            "tool_use" => {
                let name = dig(
                    &value,
                    &[&["part", "tool"], &["tool"], &["toolName"], &["name"]],
                )
                .and_then(Value::as_str);
                let input = dig(
                    &value,
                    &[
                        &["part", "state", "input"],
                        &["state", "input"],
                        &["input"],
                        &["arguments"],
                    ],
                )
                .cloned()
                .unwrap_or(Value::Null);
                let success = step_tool_success(&value);
                let workspace = self.workspace.clone();
                match name.and_then(|name| classify(name, &input, success, workspace.as_deref())) {
                    Some(kinds) if !kinds.is_empty() => {
                        kinds.into_iter().map(|kind| self.event(kind)).collect()
                    }
                    _ => vec![self.event(EventKind::Unknown { raw: value.clone() })],
                }
            }
            "error" => vec![self.event(EventKind::Error {
                message: harness_error_message(&value, "harness reported an error"),
                code: None,
            })],
            _ => vec![self.event(EventKind::Unknown { raw: value })],
        }
    }

    /// Map one line of Pi's `pi --mode json --print` JSONL stream.
    fn parse_pi(&mut self, line: &str) -> Vec<HarnessEvent> {
        let value = match self.json_line(line) {
            Ok(value) => value,
            Err(events) => return events,
        };
        let event_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        // Only the session record carries the session id.
        if event_type == "session" {
            self.capture_session(&value, &["id", "sessionId", "session_id"]);
        }
        match event_type {
            // Lifecycle markers and partial deltas are not agent activity; the
            // completed message and tool events below carry it. A tool execution
            // is split across events — the start carries the arguments, the end
            // carries only the result — so the start is recorded and the end
            // resolves it; the streaming update in between is a partial.
            "session"
            | "agent_start"
            | "agent_end"
            | "turn_start"
            | "turn_end"
            | "message_start"
            | "message_update"
            | "tool_execution_update" => Vec::new(),
            "message_end" => self.parse_pi_message(&value),
            "tool_execution_start" => {
                self.record_pi_tool(&value);
                Vec::new()
            }
            "tool_execution_end" => self.parse_pi_tool(&value),
            _ => vec![self.event(EventKind::Unknown { raw: value })],
        }
    }

    /// Record a Pi `tool_execution_start`, whose `args` carry the tool input, so
    /// the matching `tool_execution_end` — which carries only the result — can be
    /// resolved into the operation the agent requested.
    fn record_pi_tool(&mut self, value: &Value) {
        let id = value.get("toolCallId").and_then(Value::as_str);
        let name = lookup_str(value, &["toolName", "tool_name", "tool", "name"]);
        if let (Some(id), Some(name)) = (id, name) {
            let input = dig(
                value,
                &[&["args"], &["input"], &["arguments"], &["toolInput"]],
            )
            .cloned()
            .unwrap_or(Value::Null);
            self.pending_tools.push(PendingTool {
                id: id.to_string(),
                name: name.to_string(),
                input,
            });
        }
    }

    /// Emit a completed Pi assistant message as an agent event. Non-assistant
    /// roles (such as the echoed user message) are lifecycle noise.
    fn parse_pi_message(&self, value: &Value) -> Vec<HarnessEvent> {
        let Some(message) = dig(
            value,
            &[&["message"], &["assistantMessageEvent", "message"]],
        ) else {
            return Vec::new();
        };
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            return Vec::new();
        }
        let text = pi_message_text(message);
        if text.is_empty() {
            return Vec::new();
        }
        vec![self.event(EventKind::Agent { message: text })]
    }

    /// Resolve a completed Pi `tool_execution_end` into its normalized event(s)
    /// by pairing it with the `tool_execution_start` that recorded its input,
    /// since the end event carries only the result.
    fn parse_pi_tool(&mut self, value: &Value) -> Vec<HarnessEvent> {
        let id = value.get("toolCallId").and_then(Value::as_str);
        let success = pi_tool_success(value);
        self.resolve_pending_tool(id, success, value, classify_pi_tool)
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
                    path: normalize_path(path, workspace),
                    start_line,
                    end_line,
                })
            }
            "Write" | "Edit" | "MultiEdit" => Some(Self::Write {
                path: normalize_path(
                    lookup_str(input, &["file_path", "filePath", "path"])?,
                    workspace,
                ),
            }),
            "NotebookEdit" => Some(Self::Write {
                path: normalize_path(
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
                    .map(|path| normalize_path(path, workspace)),
            }),
            "Glob" => Some(Self::Search {
                query: lookup_str(input, &["pattern", "glob"])?.to_string(),
                path: input
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| normalize_path(path, workspace)),
            }),
            "LS" => Some(Self::List {
                path: input
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| normalize_path(path, workspace)),
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
                let path = normalize_path(&format!("skills/{name}/SKILL.md"), workspace);
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
        path: normalize_path(path, workspace),
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
///
/// These are container paths (e.g. `/work/src/foo.ts`) and are always
/// forward-slash separated, so normalization runs on the string directly
/// rather than through `std::path` — that keeps the result identical on
/// Windows hosts, where the native separator would otherwise leak in.
fn normalize_path(path: &str, workspace: Option<&str>) -> String {
    let is_absolute = path.starts_with('/');
    let candidate = if is_absolute {
        path.to_string()
    } else if let Some(workspace) = workspace {
        format!("{}/{}", workspace.trim_end_matches('/'), path)
    } else {
        return path.to_string();
    };
    let mut segments: Vec<&str> = Vec::new();
    for segment in candidate.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    let joined = segments.join("/");
    if candidate.starts_with('/') {
        format!("/{joined}")
    } else {
        joined
    }
}

/// A tool call recorded from its request event, awaiting the response that
/// resolves it into a normalized event.
#[derive(Debug, Clone)]
struct PendingTool {
    /// The id a later response references to pair with this call.
    id: String,
    /// The tool name, used to select the normalized mapping.
    name: String,
    /// The tool input recorded from the request.
    input: Value,
}

/// Maps a tool name and input to its normalized event(s), given the tool's
/// success and the session workspace, or `None` when the tool has no mapping.
type ToolClassifier = fn(&str, &Value, Option<bool>, Option<&str>) -> Option<Vec<EventKind>>;

/// First sub-value reachable by one of the given key paths, tried in order.
///
/// Harness tool events nest their fields inconsistently — a tool's input may sit
/// at `input`, `arguments`, or `part.state.input` — and these shapes are
/// confirmed against real CLI output rather than a published schema, so a lookup
/// tries several candidate locations and takes the first that resolves.
fn dig<'a>(value: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        Some(current)
    })
}

/// A harness error's message, from the common error-bearing locations.
fn harness_error_message(value: &Value, default: &str) -> String {
    dig(value, &[&["error", "message"], &["message"], &["error"]])
        .and_then(Value::as_str)
        .filter(|message| !message.is_empty())
        .unwrap_or(default)
        .to_string()
}

/// Wrap a possibly-empty event list, mapping empty to `None` so the caller emits
/// an unknown event rather than silently nothing.
fn non_empty(kinds: Vec<EventKind>) -> Option<Vec<EventKind>> {
    if kinds.is_empty() { None } else { Some(kinds) }
}

/// The path of a file operation, from the common path-bearing keys, normalized.
fn tool_path(input: &Value, workspace: Option<&str>) -> Option<String> {
    lookup_str(
        input,
        &[
            "path",
            "file_path",
            "filePath",
            "filepath",
            "abs_path",
            "absolutePath",
        ],
    )
    .filter(|path| !path.is_empty())
    .map(|path| normalize_path(path, workspace))
}

/// A read event from a tool input that names a path, with an optional line range
/// taken from an explicit range or a starting offset plus a line count.
fn read_event_kind(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<EventKind> {
    let path = tool_path(input, workspace)?;
    let start_line =
        lookup_u32(input, &["offset", "start_line", "startLine", "line"]).filter(|line| *line > 0);
    let end_line = lookup_u32(input, &["end_line", "endLine"])
        .filter(|line| *line > 0)
        .or_else(|| {
            start_line.and_then(|start| {
                lookup_u32(
                    input,
                    &["limit", "line_count", "lineCount", "num_lines", "numLines"],
                )
                .map(|count| start.saturating_add(count).saturating_sub(1))
            })
        });
    Some(EventKind::Read {
        path,
        start_line,
        end_line,
        is_success,
    })
}

/// A write event from a tool input that names a path.
fn write_event_kind(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<EventKind> {
    Some(EventKind::Write {
        path: tool_path(input, workspace)?,
        start_line: None,
        end_line: None,
        is_success,
    })
}

/// A search event from a tool input that carries a pattern or glob.
fn search_event_kind(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<EventKind> {
    let query = lookup_str(
        input,
        &[
            "pattern",
            "query",
            "regex",
            "glob",
            "search",
            "searchText",
            "q",
        ],
    )
    .filter(|query| !query.is_empty())?
    .to_string();
    let path = lookup_str(input, &["path", "dir", "directory", "cwd", "scope"])
        .filter(|path| !path.is_empty())
        .map(|path| normalize_path(path, workspace));
    Some(EventKind::Search {
        query,
        path,
        is_success,
    })
}

/// A list event from a tool input that may name a directory.
fn list_event_kind(input: &Value, is_success: Option<bool>, workspace: Option<&str>) -> EventKind {
    let path = lookup_str(input, &["path", "dir", "directory"])
        .filter(|path| !path.is_empty())
        .map(|path| normalize_path(path, workspace));
    EventKind::List { path, is_success }
}

/// A command event from a tool input that carries a shell command, reusing the
/// shared command classifier so a recognized file operation is reclassified.
fn bash_event_kind(input: &Value, is_success: Option<bool>) -> Option<EventKind> {
    let command =
        lookup_str(input, &["command", "cmd", "script"]).filter(|command| !command.is_empty())?;
    Some(classify_command(command, None, is_success))
}

/// A skill event from a tool input that identifies the loaded skill, preferring
/// an explicit path, then a skill directory, then the `skills/<name>` convention.
fn skill_event_kind(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<EventKind> {
    let name =
        lookup_str(input, &["name", "skill", "skill_name", "skillName"]).filter(|n| !n.is_empty());
    let path = if let Some(path) =
        lookup_str(input, &["path", "file_path", "filePath", "skillPath"]).filter(|p| !p.is_empty())
    {
        normalize_path(path, workspace)
    } else if let Some(dir) = lookup_str(input, &["dir", "directory"]).filter(|dir| !dir.is_empty())
    {
        normalize_path(
            &format!("{}/SKILL.md", dir.trim_end_matches('/')),
            workspace,
        )
    } else {
        normalize_path(&format!("skills/{}/SKILL.md", name?), workspace)
    };
    Some(EventKind::Skill {
        path,
        skill_name: name.map(str::to_string),
        start_line: None,
        end_line: None,
        is_success,
    })
}

/// Write events from an `apply_patch`-style tool: a direct path field when
/// present, otherwise the files named by the patch body's markers.
fn patch_write_events(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Vec<EventKind> {
    if let Some(path) = tool_path(input, workspace) {
        return vec![EventKind::Write {
            path,
            start_line: None,
            end_line: None,
            is_success,
        }];
    }
    let patch = lookup_str(input, &["patch", "diff", "content", "input"]).unwrap_or_default();
    patch_marker_paths(patch)
        .into_iter()
        .map(|path| EventKind::Write {
            path: normalize_path(&path, workspace),
            start_line: None,
            end_line: None,
            is_success,
        })
        .collect()
}

/// File paths named by `*** Add/Update/Delete File:` and `*** Move to:` markers
/// in an apply-patch body.
fn patch_marker_paths(patch: &str) -> Vec<String> {
    const MARKERS: &[&str] = &[
        "*** Add File:",
        "*** Update File:",
        "*** Delete File:",
        "*** Move to:",
    ];
    let mut paths = Vec::new();
    for line in patch.lines() {
        let trimmed = line.trim();
        for marker in MARKERS {
            if let Some(path) = trimmed.strip_prefix(marker).map(str::trim)
                && !path.is_empty()
                && !paths.iter().any(|seen| seen == path)
            {
                paths.push(path.to_string());
            }
        }
    }
    paths
}

/// Map an OpenCode tool name and input to its normalized event(s), or `None`
/// when the tool has no mapping (web tools, todo tools, questions, and so on).
fn classify_opencode_tool(
    name: &str,
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    match name.to_ascii_lowercase().as_str() {
        "read" => read_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "write" | "edit" => write_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "apply_patch" => non_empty(patch_write_events(input, is_success, workspace)),
        "grep" | "glob" => search_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "bash" => bash_event_kind(input, is_success).map(|kind| vec![kind]),
        "skill" => skill_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        // `lsp` is a search only when it carries a query/symbol; navigation
        // operations have none and so fall through to an unknown event.
        "lsp" => search_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        _ => None,
    }
}

/// Map a Kilo Code tool, which extends the OpenCode set with workflow and
/// semantic-search tools.
fn classify_kilo_tool(
    name: &str,
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    match name.to_ascii_lowercase().as_str() {
        "task" | "agent_manager" => kilo_orchestration(input, is_success),
        "codesearch" => search_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        _ => classify_opencode_tool(name, input, is_success, workspace),
    }
}

/// An orchestration event for a Kilo workflow tool, only when the spawned
/// agent/session can be identified; otherwise `None` so it is surfaced verbatim.
fn kilo_orchestration(input: &Value, is_success: Option<bool>) -> Option<Vec<EventKind>> {
    let subagent_id = lookup_str(
        input,
        &["sessionId", "session_id", "agentId", "agent_id", "id"],
    )
    .map(str::to_string);
    let subagent_name = lookup_str(
        input,
        &["name", "agent", "subagent", "agentType", "description"],
    )
    .map(str::to_string);
    if subagent_id.is_none() && subagent_name.is_none() {
        return None;
    }
    let action = match is_success {
        Some(false) => OrchestrationAction::SubagentFailed,
        _ => OrchestrationAction::SubagentCompleted,
    };
    Some(vec![EventKind::Orchestration {
        action,
        subagent_id,
        subagent_name,
        is_success,
    }])
}

/// Map a Pi tool name and input to its normalized event(s). Pi matches tool
/// names case-insensitively.
fn classify_pi_tool(
    name: &str,
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    match name.to_ascii_lowercase().as_str() {
        "read" => read_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "write" | "edit" => write_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "search" | "grep" | "glob" => {
            search_event_kind(input, is_success, workspace).map(|kind| vec![kind])
        }
        "list" => Some(vec![list_event_kind(input, is_success, workspace)]),
        "bash" | "shell" => bash_event_kind(input, is_success).map(|kind| vec![kind]),
        _ => None,
    }
}

/// Map a Cline tool name and input to its normalized event(s).
fn classify_cline_tool(
    name: &str,
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    match name {
        "run_commands" | "execute_command" | "bash" => cline_commands(input, is_success),
        "read_files" | "read_file" => cline_reads(input, is_success, workspace),
        "editor" | "write_to_file" | "replace_in_file" | "new_rule" => {
            write_event_kind(input, is_success, workspace).map(|kind| vec![kind])
        }
        "apply_patch" => non_empty(patch_write_events(input, is_success, workspace)),
        "search_files" | "search_codebase" => {
            search_event_kind(input, is_success, workspace).map(|kind| vec![kind])
        }
        "list_files" => Some(vec![list_event_kind(input, is_success, workspace)]),
        "skills" | "use_skill" => {
            skill_event_kind(input, is_success, workspace).map(|kind| vec![kind])
        }
        _ => None,
    }
}

/// Command events from a Cline command tool, whose input carries either a
/// `commands` array or a single command string.
fn cline_commands(input: &Value, is_success: Option<bool>) -> Option<Vec<EventKind>> {
    if let Some(commands) = input.get("commands").and_then(Value::as_array) {
        let events = commands
            .iter()
            .filter_map(Value::as_str)
            .filter(|command| !command.is_empty())
            .map(|command| classify_command(command, None, is_success))
            .collect();
        return non_empty(events);
    }
    bash_event_kind(input, is_success).map(|kind| vec![kind])
}

/// Read events from a Cline read tool, whose input carries either a `files`
/// array (of paths or file objects) or a single path.
fn cline_reads(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    if let Some(files) = input.get("files").and_then(Value::as_array) {
        let events = files
            .iter()
            .filter_map(|file| match file {
                Value::String(path) => Some(path.as_str()),
                _ => lookup_str(file, &["path", "file_path", "filePath"]),
            })
            .filter(|path| !path.is_empty())
            .map(|path| EventKind::Read {
                path: normalize_path(path, workspace),
                start_line: None,
                end_line: None,
                is_success,
            })
            .collect();
        return non_empty(events);
    }
    read_event_kind(input, is_success, workspace).map(|kind| vec![kind])
}

/// Whether a Cline tool output reports success: a `success` flag, or every item
/// succeeding when the output is a batch of per-item results.
fn cline_tool_success(output: Option<&Value>) -> Option<bool> {
    let output = output?;
    if let Some(success) = output.get("success").and_then(Value::as_bool) {
        return Some(success);
    }
    let items = output
        .as_array()
        .or_else(|| output.get("results").and_then(Value::as_array))?;
    if items.is_empty() {
        return None;
    }
    Some(items.iter().all(|item| {
        item.get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }))
}

/// Map a Goose developer/MCP tool name and input to its normalized event(s).
fn classify_goose_tool(
    name: &str,
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    // Goose and MCP servers prefix tool names with an extension id. The todo
    // extension only manages internal session state, so it is consumed.
    let (extension, base) = match name.split_once("__") {
        Some((extension, base)) => (Some(extension), base),
        None => (None, name),
    };
    if extension == Some("todo") {
        return Some(Vec::new());
    }
    match base.to_ascii_lowercase().as_str() {
        "read" => read_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "write" | "edit" => write_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "text_editor" => goose_text_editor(input, is_success, workspace),
        "shell" => bash_event_kind(input, is_success).map(|kind| vec![kind]),
        "grep" | "glob" => search_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "list" => Some(vec![list_event_kind(input, is_success, workspace)]),
        "load_skill" | "skill" => {
            skill_event_kind(input, is_success, workspace).map(|kind| vec![kind])
        }
        _ => None,
    }
}

/// A Goose text-editor tool maps to a read or write according to its command:
/// inspection commands read, mutation commands write, anything else is unknown.
fn goose_text_editor(
    input: &Value,
    is_success: Option<bool>,
    workspace: Option<&str>,
) -> Option<Vec<EventKind>> {
    match lookup_str(input, &["command", "cmd"]).unwrap_or_default() {
        "view" | "read" => read_event_kind(input, is_success, workspace).map(|kind| vec![kind]),
        "write" | "create" | "overwrite" | "edit" | "str_replace" | "insert" | "move"
        | "rename" | "delete" => {
            write_event_kind(input, is_success, workspace).map(|kind| vec![kind])
        }
        _ => None,
    }
}

/// A pending tool from a Goose `toolRequest` content block.
fn goose_tool_request(block: &Value) -> Option<PendingTool> {
    let id = goose_tool_id(block, "toolRequest")?;
    let name = dig(
        block,
        &[
            &["toolCall", "value", "name"],
            &["tool_call", "value", "name"],
            &["name"],
        ],
    )
    .and_then(Value::as_str)?
    .to_string();
    let input = dig(
        block,
        &[
            &["toolCall", "value", "arguments"],
            &["arguments"],
            &["input"],
        ],
    )
    .cloned()
    .unwrap_or(Value::Null);
    Some(PendingTool { id, name, input })
}

/// The tool-call id carried by a Goose tool request or response block.
fn goose_tool_id(block: &Value, wrapper: &str) -> Option<String> {
    dig(block, &[&["id"], &[wrapper, "id"], &["toolCallId"]])
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Whether a Goose `toolResponse` reports success, from its result status.
fn goose_response_success(block: &Value) -> Option<bool> {
    match dig(
        block,
        &[
            &["toolResult", "status"],
            &["toolResponse", "toolResult", "status"],
            &["status"],
        ],
    )
    .and_then(Value::as_str)
    {
        Some("success") => Some(true),
        Some("error") => Some(false),
        _ => None,
    }
}

/// Whether an OpenCode-style tool event reports success, from its terminal
/// status.
fn step_tool_success(value: &Value) -> Option<bool> {
    match dig(
        value,
        &[
            &["part", "state", "status"],
            &["state", "status"],
            &["status"],
        ],
    )
    .and_then(Value::as_str)
    {
        Some("completed" | "success" | "done" | "ok") => Some(true),
        Some("error" | "failed" | "failure" | "cancelled" | "canceled") => Some(false),
        _ => None,
    }
}

/// Whether a Pi `tool_execution_end` reports success. Pi flags a failed call
/// with an `isError` boolean on the end event; a completed call that carries a
/// result and no error succeeded. A status/error field is honored as a fallback.
fn pi_tool_success(value: &Value) -> Option<bool> {
    if let Some(is_error) = value.get("isError").and_then(Value::as_bool) {
        return Some(!is_error);
    }
    if value.get("error").is_some_and(|error| !error.is_null()) {
        return Some(false);
    }
    if value.get("result").is_some() {
        return Some(true);
    }
    match lookup_str(value, &["status", "state"]) {
        Some("completed" | "success" | "ok" | "done") => Some(true),
        Some("error" | "failed" | "failure") => Some(false),
        _ => None,
    }
}

/// The text of a Pi assistant message, whose content is a string or an array of
/// text parts.
fn pi_message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                (part.get("type").and_then(Value::as_str) == Some("text"))
                    .then(|| part.get("text").and_then(Value::as_str))
                    .flatten()
            })
            .collect(),
        _ => String::new(),
    }
}

#[cfg(test)]
#[path = "event.test.rs"]
mod tests;
