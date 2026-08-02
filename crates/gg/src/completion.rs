//! The **ending calls** an agent is offered, and the optional external **validation** that gates
//! them.
//!
//! How an agent declares it is done is **not** configurable and never was worth making so. Every
//! agent ends its session with an explicit, typed call, in both execution modes: a tool-calling reply
//! that requests no tools is an error, and a
//! [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) reply that is not a
//! program is an error. *Which* calls an agent has is decided by its [role](crate::ending::EndingRole)
//! — see [`crate::ending`], which owns the shapes; this module owns how they reach a **tool-calling**
//! model, as the [synthetic tool definitions](role_tool_definitions) the loop appends and intercepts.
//!
//! What the [completion](test_cabinet_core::gg::CAPABILITY_COMPLETION) capability still configures is
//! the one thing that genuinely varies between studies: the [validation](ValidationCommand) commands
//! gg runs when the model signals it is done. The session only ends if every command exits `0`; a
//! failure's output is handed back to the model and the run continues. A profile that does not enable
//! the capability leaves the ending ungated.

use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};
use test_cabinet_core::gg::{CAPABILITY_COMPLETION, GgAgentConfig, GgTelemetryKind};
use test_cabinet_core::gg_replay::GgShellOrigin;

use crate::ending::EndingRole;
use crate::model::ToolDefinition;
use crate::prompts::{self, ValidationFailureContext};
use crate::sandbox::FINISH_FUNCTION;
use crate::telemetry::Emitter;
use crate::tools::{OffloadPolicy, ToolContext, run_command};

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

/// The four **ending call** names, shared by both execution modes so that ending a session is one
/// vocabulary a model learns once — `harness.finish(…)` in a program and `finish` as a tool are the
/// same call.
///
/// Each is a **loop-level synthetic**: appended to the offered set by [`Agent::drive`](crate::agent)
/// according to the agent's [role](EndingRole) and intercepted by the loop. None is a registry tool
/// or a name in [`ALL_TOOL_NAMES`](crate::tools::ALL_TOOL_NAMES), exactly as their code-mode
/// counterparts are not in the sandbox's tool catalogue.
pub(crate) const FINISH_TOOL: &str = FINISH_FUNCTION;
/// See [`FINISH_TOOL`]. A reviewer's approval.
pub(crate) const APPROVE_TOOL: &str = "approve";
/// See [`FINISH_TOOL`]. A reviewer's rejection, carrying the changes it requires.
pub(crate) const REQUEST_CHANGES_TOOL: &str = "request_changes";
/// See [`FINISH_TOOL`]. A judge's pick among the attempts it was shown.
pub(crate) const SELECT_WINNER_TOOL: &str = "select_winner";

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

/// The resolved completion gate for one agent: the [validation](ValidationCommand) commands that
/// must pass before its ending is accepted.
#[derive(Debug, Clone, Default)]
pub(crate) struct CompletionSetup {
    /// The commands that gate an ending, run in order when the model signals it is done. Empty
    /// leaves the ending ungated.
    validation: Vec<ValidationCommand>,
}

impl CompletionSetup {
    /// Resolve `profile`'s [validation](ValidationCommand) commands from the
    /// [completion](CAPABILITY_COMPLETION) capability's `validation` param.
    ///
    /// A capability that is absent **or** present-but-disabled yields no commands, so the disabled
    /// arm of an ablation is the unchanged control.
    pub(crate) fn resolve(profile: &GgAgentConfig) -> Self {
        let validation = profile
            .capability(CAPABILITY_COMPLETION)
            .filter(|capability| capability.enabled)
            .and_then(|capability| capability.params.get(PARAM_VALIDATION))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(ValidationCommand::from_value)
                    .collect()
            })
            .unwrap_or_default();
        Self { validation }
    }

    /// Whether the ending is gated behind at least one validation command.
    pub(crate) fn has_validation(&self) -> bool {
        !self.validation.is_empty()
    }

    /// The validation commands, for the system prompt's description of what gates the ending.
    pub(crate) fn validation(&self) -> &[ValidationCommand] {
        &self.validation
    }
}

/// The tool-calling definitions of `role`'s [ending calls](FINISH_TOOL) — the synthetic tools the
/// loop appends to the offered set and intercepts.
///
/// They are built here rather than in the registry for the same reason their code-mode counterparts
/// are outside the sandbox's tool catalogue: nothing dispatches them. A call to one is read by the
/// loop as a **declaration**, and its arguments are the declaration's content, which is why each
/// schema demands exactly what that role's verdict is made of and nothing more.
pub(crate) fn role_tool_definitions(role: EndingRole) -> Vec<ToolDefinition> {
    match role {
        EndingRole::Standard => vec![ToolDefinition::new(
            FINISH_TOOL,
            "End your session once the work is complete, reporting what you did. This is the only \
             way to end it: a reply with no tool call does not.",
            json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "What you did, in a sentence or two."
                    }
                },
                "required": ["summary"],
                "additionalProperties": false
            }),
        )],
        EndingRole::Review => vec![
            ToolDefinition::new(
                APPROVE_TOOL,
                "Accept the work you are reviewing: it meets every completion criterion and stays \
                 in scope. Ends your session.",
                json!({
                    "type": "object",
                    "properties": {},
                    "additionalProperties": false
                }),
            ),
            ToolDefinition::new(
                REQUEST_CHANGES_TOOL,
                "Reject the work you are reviewing, listing every change it needs before it can be \
                 accepted. Ends your session.",
                json!({
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "minItems": 1,
                            "items": { "type": "string" },
                            "description": "One change per entry, each saying what is wrong and \
                                            what to change."
                        }
                    },
                    "required": ["items"],
                    "additionalProperties": false
                }),
            ),
        ],
        EndingRole::Judge { attempts } => vec![ToolDefinition::new(
            SELECT_WINNER_TOOL,
            "Name the attempt that wins. Ends your session.",
            json!({
                "type": "object",
                "properties": {
                    "attempt": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": attempts.max(1),
                        "description": "The number the winning attempt was presented under."
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Why that attempt won, in a sentence."
                    }
                },
                "required": ["attempt", "rationale"],
                "additionalProperties": false
            }),
        )],
    }
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
///
/// A validation command's output is the agent's to read — the failure is handed straight back to it
/// — so it runs under the agent's own [output policy](OffloadPolicy). A failing test suite is
/// exactly the kind of output that arrives by the megabyte, and under offloading the agent is shown
/// the tail that names the failure and can grep the rest out of the file pair.
/// A validation command runs `sh -c` through the same code path a `shell` tool call does but never
/// reaches tool dispatch, and it decides whether the session is allowed to end — which is as
/// control-flow-changing as an input gets. It is [captured](crate::replay) like every other command
/// line, at the [shell seam](crate::tools::ShellRunner) the context carries, under the
/// [`CompletionValidation`](GgShellOrigin::CompletionValidation) origin this function stamps on it —
/// which is what keeps it off the agent's ordinary queue.
pub(crate) async fn run_validation(
    commands: &[ValidationCommand],
    base: &ToolContext,
    offload: &OffloadPolicy,
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
        // Derived from the agent's own context rather than built fresh, so a command that declared
        // a `cwd` still runs through *this agent's* [shell runner](crate::tools::ShellRunner) and
        // still names the agent whose ending it gates. A bare `ToolContext::new` would silently
        // give it the real shell and no attribution — which for the one input that decides whether
        // a session may end is the worst place in gg to lose either.
        let ctx = base.rooted_at(cwd);
        // The capture happens **below** this call, at the shell seam: the recording runner is
        // rooted at the agent's own workspace, so a command declaring `cwd: "web"` and one
        // declaring nothing are recorded as the different commands they are, rather than both
        // resolved to "here".
        let outcome = run_command(
            &command.command,
            command.timeout,
            offload,
            &ctx,
            GgShellOrigin::CompletionValidation,
        )
        .await;
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
    prompts::render_completion_validation_failure(&ValidationFailureContext {
        index,
        total,
        command: &command.display(),
        output,
    })
}

/// The message handed back to the model when a tool-calling turn requested no tools at all — a
/// text-only reply, which is an error rather than an ending. It names the calls `role` actually has,
/// so a reviewer is never pointed at a `finish` it was not given.
pub(crate) fn missing_completion_feedback(role: EndingRole) -> String {
    prompts::render_completion_missing(role.tools())
}

#[cfg(test)]
#[path = "completion.test.rs"]
mod tests;
