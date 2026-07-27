//! How a run decides it is **finished**, and the optional external **validation** that gates it.
//!
//! Every gg run needs a rule for when it is done. Historically that rule was fixed per execution
//! mode: a tool-calling turn that requested no tools ended the run, and a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) program ended it by
//! calling `finish`. The [completion](test_cabinet_core::gg::CAPABILITY_COMPLETION) capability makes
//! that rule configurable, along two independent axes this module resolves from an agent's profile
//! into a [`CompletionSetup`]:
//!
//! - the [signal](CompletionSignal) — [plain text](CompletionSignal::PlainText) (a tool-calling
//!   reply with no tool calls means done) or an [explicit call](CompletionSignal::ExplicitCall) to
//!   the `finish` tool (a text-only reply is then an *error*, not a completion). The signal governs
//!   only the tool-calling path; a code-mode run always ends through its program's `finish`.
//! - the [validation](ValidationCommand) commands — an optional external check gg runs when the
//!   model signals completion, in either execution mode. The run only ends if every command exits
//!   `0`; a failure's output is handed back to the model and the run continues.
//!
//! When a profile does not enable the capability, [`CompletionSetup::resolve`] yields the historical
//! defaults (a plain-text signal and no validation), so an unconfigured run is unchanged.

use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};
use test_cabinet_core::gg::{
    CAPABILITY_COMPLETION, COMPLETION_SIGNAL_EXPLICIT_CALL, COMPLETION_SIGNAL_PLAIN_TEXT,
    GgAgentConfig, GgTelemetryKind,
};

use crate::model::ToolDefinition;
use crate::sandbox::FINISH_FUNCTION;
use crate::telemetry::Emitter;
use crate::tools::{ToolContext, run_command};

/// The `validation` param key: an array of validation commands on the
/// [completion](CAPABILITY_COMPLETION) capability.
const PARAM_VALIDATION: &str = "validation";
/// The per-command `command` key: the command line run via `sh -c`.
const PARAM_COMMAND: &str = "command";
/// The per-command `cwd` key: where to run the command (relative to gg's working directory, or
/// absolute). Absent means gg's working directory.
const PARAM_CWD: &str = "cwd";
/// The per-command `timeoutSecs` key: how long the command may run before it is killed.
const PARAM_TIMEOUT_SECS: &str = "timeoutSecs";

/// The per-command timeout used when a validation command declares none. Generous, because a
/// validation command is typically a build or a test suite rather than a quick check.
const DEFAULT_VALIDATION_TIMEOUT: Duration = Duration::from_secs(300);

/// The name of the tool/function that ends a run when the model must signal completion explicitly —
/// the same name in both execution modes, so "end the run" is one word a model learns once.
///
/// It is [`FINISH_FUNCTION`], the responses-as-code sandbox's finish function, reused here for the
/// tool-calling finish tool. That tool is a **loop-level synthetic** appended to the offered set by
/// [`Agent::drive`](crate::agent) and intercepted by the loop — it is deliberately not a registry
/// tool and not in [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES), exactly as the code-mode
/// `finish` is not.
pub(crate) const FINISH_TOOL: &str = FINISH_FUNCTION;

/// How the model signals that it believes the run is complete — the
/// [completion](CAPABILITY_COMPLETION) capability's implementation, on the tool-calling path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompletionSignal {
    /// A tool-calling reply that requests no tools ends the run. The historical default, and what an
    /// unconfigured run uses.
    PlainText,
    /// The model must call the [`finish`](FINISH_TOOL) tool to end the run; a reply with no tool
    /// call is treated as an error and fed back, so a run that never learns to call `finish` stops
    /// on its error ceilings rather than looping to its turn budget.
    ExplicitCall,
}

impl CompletionSignal {
    /// The signal an [implementation](test_cabinet_core::gg::GgCapabilityConfig::implementation)
    /// string names, or `None` for an empty or unrecognized value (which resolves to the default).
    fn from_impl(value: &str) -> Option<Self> {
        match value {
            COMPLETION_SIGNAL_PLAIN_TEXT => Some(Self::PlainText),
            COMPLETION_SIGNAL_EXPLICIT_CALL => Some(Self::ExplicitCall),
            _ => None,
        }
    }
}

/// One command gg runs to [validate](CompletionSetup::validation) a completion before it is
/// accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidationCommand {
    /// The command line, run via `sh -c` exactly as the [shell tool](crate::tools) runs one.
    command: String,
    /// Where to run it: a path relative to gg's working directory, or an absolute path. `None` runs
    /// it in gg's working directory (the agent's workspace root).
    cwd: Option<String>,
    /// How long it may run before it is killed.
    timeout: Duration,
}

impl ValidationCommand {
    /// Parse one entry of the `validation` array. An entry may be a bare command string (shorthand
    /// for a command in gg's working directory) or an object with a required `command` and optional
    /// `cwd` / `timeoutSecs`. A malformed entry (no usable command) is dropped.
    fn from_value(value: &Value) -> Option<Self> {
        if let Some(command) = value.as_str() {
            let command = command.trim();
            return (!command.is_empty()).then(|| Self {
                command: command.to_string(),
                cwd: None,
                timeout: DEFAULT_VALIDATION_TIMEOUT,
            });
        }
        let command = value
            .get(PARAM_COMMAND)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|command| !command.is_empty())?;
        let cwd = value
            .get(PARAM_CWD)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|cwd| !cwd.is_empty())
            .map(str::to_string);
        let timeout = value
            .get(PARAM_TIMEOUT_SECS)
            .and_then(Value::as_f64)
            .filter(|secs| secs.is_finite() && *secs > 0.0)
            .map(Duration::from_secs_f64)
            .unwrap_or(DEFAULT_VALIDATION_TIMEOUT);
        Some(Self {
            command: command.to_string(),
            cwd,
            timeout,
        })
    }

    /// How the command reads in the system prompt and in feedback — the command line, and where it
    /// runs when that is not gg's working directory.
    pub(crate) fn display(&self) -> String {
        match &self.cwd {
            Some(cwd) => format!("{} (in {cwd})", self.command),
            None => self.command.clone(),
        }
    }
}

/// The resolved completion rule for one agent: its [signal](CompletionSignal) and its
/// [validation](ValidationCommand) commands.
#[derive(Debug, Clone)]
pub(crate) struct CompletionSetup {
    /// The tool-calling completion signal. Inert on the responses-as-code path, which always ends
    /// through its program's `finish` call.
    signal: CompletionSignal,
    /// The commands that gate a completion, run in order when the model signals it is done. Empty
    /// leaves completion ungated.
    validation: Vec<ValidationCommand>,
}

impl CompletionSetup {
    /// Resolve `profile`'s completion rule: its [signal](CompletionSignal) (from the capability's
    /// implementation, defaulting to [plain text](CompletionSignal::PlainText)) and its
    /// [validation](ValidationCommand) commands (from the capability's `validation` param).
    ///
    /// A [completion](CAPABILITY_COMPLETION) capability that is absent **or** present-but-disabled
    /// yields the historical defaults — a plain-text signal and no validation — so the disabled arm
    /// of an ablation is the unchanged control.
    pub(crate) fn resolve(profile: &GgAgentConfig) -> Self {
        let active = profile
            .capability(CAPABILITY_COMPLETION)
            .filter(|capability| capability.enabled);
        let signal = active
            .and_then(|capability| capability.implementation.as_deref())
            .map(str::trim)
            .and_then(CompletionSignal::from_impl)
            .unwrap_or(CompletionSignal::PlainText);
        let validation = active
            .and_then(|capability| capability.params.get(PARAM_VALIDATION))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(ValidationCommand::from_value)
                    .collect()
            })
            .unwrap_or_default();
        Self { signal, validation }
    }

    /// The configured completion signal.
    pub(crate) fn signal(&self) -> CompletionSignal {
        self.signal
    }

    /// Whether completion is gated behind at least one validation command.
    pub(crate) fn has_validation(&self) -> bool {
        !self.validation.is_empty()
    }

    /// The validation commands, for the system prompt's description of what gates completion.
    pub(crate) fn validation(&self) -> &[ValidationCommand] {
        &self.validation
    }

    /// Whether this run reaches completion through an **explicit `finish` call** on the tool-calling
    /// path — the condition under which gg offers the `finish` tool and treats a text-only reply as
    /// an error. Always false in `responses_as_code` mode, whose program-driven `finish` this
    /// tool-calling machinery does not touch.
    pub(crate) fn explicit_finish(&self, responses_as_code: bool) -> bool {
        !responses_as_code && self.signal == CompletionSignal::ExplicitCall
    }
}

/// The definition of the tool-calling `finish` tool, offered when an agent completes through an
/// [explicit call](CompletionSignal::ExplicitCall).
pub(crate) fn finish_tool_definition() -> ToolDefinition {
    ToolDefinition::new(
        FINISH_TOOL,
        "End the run. Call this once the work is complete, passing a short summary of what you did \
         — the summary becomes the run's final message. Until you call it the run continues; a \
         reply with no tool call does NOT end the run.",
        json!({
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "A short summary of the completed work. Becomes the run's final \
                                    message."
                }
            },
            "required": ["summary"],
            "additionalProperties": false
        }),
    )
}

/// Run `commands` in order to gate a completion, returning `None` when every one succeeds (the run
/// may end) or `Some(feedback)` describing the first failure (the run continues, with the feedback
/// handed back to the model).
///
/// Each command runs via `sh -c` — the same execution path the [shell tool](crate::tools) uses — in
/// its resolved working directory: gg's working directory (`base.workspace_dir`) when the command
/// declares no `cwd`, else the declared `cwd` resolved against it (or used verbatim when absolute).
/// Commands are run **fail-fast**: the first non-zero exit stops the batch, because a later command
/// usually depends on an earlier one (a test suite on a build) and its output would only add noise
/// to the one the model must actually fix.
pub(crate) async fn run_validation(
    commands: &[ValidationCommand],
    base: &ToolContext,
    emitter: &Emitter,
) -> Option<String> {
    let total = commands.len();
    emitter.emit(GgTelemetryKind::Log {
        level: "info".to_string(),
        message: format!(
            "running {total} validation command(s) to confirm the work is complete before ending \
             the run.",
        ),
    });
    for (index, command) in commands.iter().enumerate() {
        let cwd = match &command.cwd {
            None => base.workspace_dir.clone(),
            Some(dir) => {
                let path = Path::new(dir);
                if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    base.workspace_dir.join(path)
                }
            }
        };
        let ctx = ToolContext::new(cwd);
        let outcome = run_command(&command.command, command.timeout, &ctx).await;
        if outcome.ok {
            emitter.emit(GgTelemetryKind::Log {
                level: "info".to_string(),
                message: format!(
                    "validation command {} of {total} passed: `{}`",
                    index + 1,
                    command.command,
                ),
            });
            continue;
        }
        emitter.emit(GgTelemetryKind::Log {
            level: "warn".to_string(),
            message: format!(
                "validation command {} of {total} failed: `{}` — the completion is rejected and \
                 the run continues.",
                index + 1,
                command.command,
            ),
        });
        return Some(validation_failure_feedback(
            index + 1,
            total,
            command,
            &outcome.output,
        ));
    }
    None
}

/// The message handed back to the model when a validation command rejects its completion: which
/// command failed, its output, and that the run will not end until every command passes.
fn validation_failure_feedback(
    index: usize,
    total: usize,
    command: &ValidationCommand,
    output: &str,
) -> String {
    format!(
        "Your completion was NOT accepted: gg runs validation command(s) to confirm the work is \
         complete before ending the run, and one failed.\n\n\
         Command {index} of {total}: `{}`\n\n{output}\n\n\
         Fix the problem and signal completion again. The run will not end until every validation \
         command exits 0.",
        command.display(),
    )
}

/// The message handed back to the model when it ends a turn without calling [`finish`](FINISH_TOOL)
/// under an [explicit-call](CompletionSignal::ExplicitCall) signal — a text-only reply that is an
/// error rather than a completion.
pub(crate) fn missing_completion_feedback() -> String {
    format!(
        "Your reply requested no tools. In this run a message with no tool call does NOT end the \
         run — you must call the `{FINISH_TOOL}` tool to finish. If you are done, call `{FINISH_TOOL}` \
         with a summary of your work. Otherwise, keep working by calling tools.",
    )
}

#[cfg(test)]
#[path = "completion.test.rs"]
mod tests;
