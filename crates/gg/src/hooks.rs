//! **Hooks**: the operator's seam into a run's lifecycle.
//!
//! A [hook](GgHook) is a command or a script gg runs at one of ten
//! [points](GgHookEvent) in a run — around a file write, around a shell command, around a
//! compaction, as an agent starts or tries to stop, and at the session's two ends. What a hook can
//! do is deliberately narrow, and the same two things everywhere: **stop** the operation it
//! precedes, and **put text in front of the model**.
//!
//! # Why this is not a capability
//!
//! Everything else gg configures is a capability: a feature the model is offered, an arm a study
//! ablates. A hook is the opposite end of the telescope — the operator reaching in from outside the
//! run. The model is never told a hook exists, is offered no tool for one, and cannot decline one;
//! a blocked write comes back looking like a refusal from the harness, because that is what it is.
//! So hooks are declared once for the whole run ([`GgCapabilitySet::hooks`]) rather than per
//! profile, and they never appear in the `cap.*` query namespace.
//!
//! This module is also where the old `completion` capability went. Its validation commands were a
//! gate on one event (an agent ending) expressed as a capability, which meant they applied to
//! whichever profiles remembered to enable it and could express nothing but "run this, non-zero is
//! a failure". As an [agent-stop](GgHookEvent::AgentStop) [command hook](GgHookAction::Command)
//! they are the same gate, spelled once, for every agent — and a run that wants more than an exit
//! code can now reach for a script instead.
//!
//! # The two shapes of hook
//!
//! A **command** hook ([`GgHookAction::Command`]) is the simple case: gg runs a command line and
//! reads its exit status. It gets no input, because the checks that are already commands (`npm
//! test`, `cargo clippy`) read the workspace rather than being told about it. Non-zero blocks; the
//! output is shown to the model either way, through the agent's own
//! [offloading policy](OffloadPolicy) so a megabyte of test failure behaves like a megabyte of
//! `shell` output rather than flooding a window.
//!
//! A **script** hook ([`GgHookAction::BuiltIn`] / [`GgHookAction::Custom`]) is the expressive case:
//! gg hands it the event as one JSON argument and reads a [decision](GgHookOutcomeKind) back on
//! stdout. That is what buys "let this through, but tell the model X" — an outcome no exit code can
//! express. The two variants are one execution path; a built-in is gg's own source rather than the
//! configuration's, and exists to be read and copied.
//!
//! # Failure is not a verdict
//!
//! A script that exits non-zero, or prints something gg cannot parse, has **not judged anything**.
//! Letting the operation through would be pretending it passed; blocking it would be pretending it
//! failed. Both are lies about a gate an operator is relying on, so gg does neither and
//! [stops the run](HookFailure) with the script's own stderr. This is the one place in gg where a
//! misbehaving subprocess is fatal rather than fed back to the model, and it is fatal precisely
//! because the model is not the one who asked for it.

use std::collections::BTreeMap;
use std::fmt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{Value, json};
use test_cabinet_core::gg::{
    GG_BUILTIN_HOOKS, GgCapabilitySet, GgHook, GgHookAction, GgHookAgentKind, GgHookEvent,
    GgHookOutcomeKind, GgTelemetryKind,
};
use test_cabinet_core::gg_replay::GgShellOrigin;

use crate::telemetry::Emitter;
use crate::tools::{OffloadPolicy, ToolContext, run_command};

#[path = "hooks.builtin.rs"]
mod builtin;

pub(crate) use builtin::builtin_source;

/// The per-hook timeout gg falls back to when a hook declares none. Generous, on the same reasoning
/// the validation commands this replaced used: a hook command is typically a build or a test suite
/// rather than a quick check.
const DEFAULT_HOOK_TIMEOUT: Duration = Duration::from_secs(300);

/// The directory, under the run's own [workspace bookkeeping](test_cabinet_core::gg::GG_WORKSPACE_DIR),
/// that script hooks are materialized into.
///
/// Inside `.gg/` rather than a temp directory so a script is where everything else gg wrote is —
/// excluded from the seed commit, carried in the run archive, and therefore *readable afterwards*
/// by whoever is asking why a hook blocked.
const HOOK_SCRIPT_DIR: &str = ".gg/hooks";

/// One hook, resolved: its declaration plus the source a script hook will be run from.
///
/// Resolved once at launch rather than per firing, because the failure it can produce — a built-in
/// id gg does not ship — is a **configuration** error, and a configuration error found on the
/// four-hundredth file write is one an operator has already paid for.
#[derive(Debug, Clone)]
struct ResolvedHook {
    /// How this hook reads in a diagnostic: its operator-given name, or a description of what it
    /// runs. Never empty, so every report of a hook firing can name one.
    label: String,
    /// What it runs.
    action: GgHookAction,
    /// The event it fires on, carried alongside the action so a fired hook can check its own
    /// [blocking rights](GgHookEvent::can_block) without the caller passing them back in.
    event: GgHookEvent,
}

/// A hook's own machinery failing — a script that exited non-zero, or printed a decision gg could
/// not read.
///
/// Distinct from a hook *blocking*, and fatal where a block is not, for the reason the module doc
/// gives: a broken gate has not judged. It carries enough to say which hook and why, because the
/// run is about to stop over it.
#[derive(Debug, Clone)]
pub(crate) struct HookFailure {
    /// The hook that failed, by [label](ResolvedHook::label).
    pub(crate) hook: String,
    /// What went wrong, in the operator's terms.
    pub(crate) detail: String,
}

impl fmt::Display for HookFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "hook `{}` failed: {}", self.hook, self.detail)
    }
}

/// What firing one event's hooks came to.
///
/// Both halves can be non-empty at once: hooks run in declaration order, so an earlier hook may
/// have inserted a message before a later one blocked. Both are reported — the block because it
/// decides what happens, the messages because a model told *why* something was refused deserves
/// whatever else was being said at the time.
#[derive(Debug, Clone, Default)]
pub(crate) struct HookRun {
    /// Why the operation was refused, when a hook refused it. `None` lets the operation proceed.
    pub(crate) blocked: Option<String>,
    /// The messages hooks asked to be put in front of the model, in the order they were produced.
    pub(crate) messages: Vec<String>,
}

impl HookRun {
    /// Whether the operation this run gated may go ahead.
    pub(crate) fn allowed(&self) -> bool {
        self.blocked.is_none()
    }

    /// The messages as one block of prompt text, labelled so the model can tell hook output from
    /// something it produced itself. `None` when no hook said anything.
    pub(crate) fn insertion(&self) -> Option<String> {
        (!self.messages.is_empty()).then(|| {
            let body = self.messages.join("\n\n");
            format!("Hook output\n----\n{body}")
        })
    }
}

/// Who a hook is firing for — the facts every event's payload carries regardless of what the event
/// itself is about.
///
/// Every payload carries these because a hook is a *run-level* declaration firing on a
/// *per-agent* event: a script asked to decide about a write has no other way to know which of a
/// dozen concurrent agents is writing, or whether that agent is working in an isolated worktree
/// where the path it is being shown means something different from the same path in the main tree.
#[derive(Debug, Clone, Default)]
pub(crate) struct HookAgent {
    /// The agent instance's id — its handle in the tree and in the telemetry.
    pub(crate) agent_id: String,
    /// The agent **profile**'s name: the slug a configuration declares it under.
    pub(crate) agent: String,
    /// The role this instance was dispatched in.
    pub(crate) kind: Option<GgHookAgentKind>,
    /// The isolated worktree this instance works in, as `(branch, path)`, when it has one.
    pub(crate) worktree: Option<(String, PathBuf)>,
}

impl HookAgent {
    /// A bare agent identity — everything unknown but the id, for the events that fire outside any
    /// dispatch.
    pub(crate) fn new(agent_id: impl Into<String>, agent: impl Into<String>) -> Self {
        Self {
            agent_id: agent_id.into(),
            agent: agent.into(),
            kind: None,
            worktree: None,
        }
    }

    /// This identity, dispatched in `kind`'s role.
    pub(crate) fn of_kind(mut self, kind: GgHookAgentKind) -> Self {
        self.kind = Some(kind);
        self
    }

    /// This identity, working in an isolated worktree.
    pub(crate) fn in_worktree(mut self, worktree: Option<(String, PathBuf)>) -> Self {
        self.worktree = worktree;
        self
    }

    /// The common half of an event payload.
    fn to_json(&self) -> serde_json::Map<String, Value> {
        let mut map = serde_json::Map::new();
        map.insert("agentId".into(), json!(self.agent_id));
        map.insert("agent".into(), json!(self.agent));
        map.insert(
            "agentKind".into(),
            self.kind.map(|k| json!(k.as_str())).unwrap_or(Value::Null),
        );
        map.insert(
            "worktree".into(),
            match &self.worktree {
                Some((branch, path)) => json!({
                    "branch": branch,
                    "path": path.to_string_lossy(),
                }),
                None => Value::Null,
            },
        );
        map
    }
}

/// The run's hooks, grouped by the event they fire on.
///
/// Built once at launch and shared by every agent, because the declaration is the run's. Grouping
/// by event is what makes the common case — an event with no hooks on it, which is most events of
/// most runs — a map lookup that finds nothing, rather than a walk of every hook per file write.
#[derive(Debug, Default)]
pub(crate) struct HookRuntime {
    /// The hooks on each event, in declaration order.
    by_event: BTreeMap<GgHookEvent, Vec<ResolvedHook>>,
    /// Where a script hook's source is written before it is run — under the run's workspace.
    scripts_dir: PathBuf,
}

impl HookRuntime {
    /// Resolve `set`'s hooks against `workspace_dir`, or report the configuration errors that stop
    /// the run.
    ///
    /// The only resolution that can fail is a [built-in](GgHookAction::BuiltIn) naming a script gg
    /// does not ship. It fails the launch rather than skipping the hook, on the rule a gate has to
    /// follow: a hook that silently does not run is worse than no hook, because an operator
    /// believes they have one.
    pub(crate) fn resolve(
        set: &GgCapabilitySet,
        workspace_dir: &Path,
    ) -> Result<Self, Vec<String>> {
        let mut by_event: BTreeMap<GgHookEvent, Vec<ResolvedHook>> = BTreeMap::new();
        let mut errors = Vec::new();
        for (index, hook) in set.hooks.iter().enumerate() {
            let label = hook_label(hook, index);
            if let GgHookAction::BuiltIn { script } = &hook.action
                && builtin_source(script).is_none()
            {
                errors.push(format!(
                    "hook `{label}`: `{script}` is not a built-in hook script. gg ships: {}.",
                    GG_BUILTIN_HOOKS.join(", "),
                ));
                continue;
            }
            by_event.entry(hook.event).or_default().push(ResolvedHook {
                label,
                action: hook.action.clone(),
                event: hook.event,
            });
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        Ok(Self {
            by_event,
            scripts_dir: workspace_dir.join(HOOK_SCRIPT_DIR),
        })
    }

    /// Whether any hook fires on `event` — the cheap question every firing site asks first, so a
    /// run with no hooks pays a map lookup per write rather than building a payload nobody reads.
    pub(crate) fn has(&self, event: GgHookEvent) -> bool {
        self.by_event.contains_key(&event)
    }

    /// How many hooks fire on `event` — what the run's opening announcement counts, so an operator
    /// reading the log sees the gates they configured before the first one fires.
    pub(crate) fn count(&self, event: GgHookEvent) -> usize {
        self.by_event.get(&event).map_or(0, Vec::len)
    }

    /// Fire every hook on `event`, in declaration order, and report what came of it.
    ///
    /// `payload` is the event-specific half of what a script is shown; the [agent](HookAgent) half
    /// is added here, so no calling site can forget it. Hooks run **sequentially** and the first
    /// block stops the rest: a later hook's opinion of an operation that is not going to happen is
    /// not worth the wall clock, and running it anyway would mean a `post-` side effect for a
    /// `pre-` event that was refused.
    pub(crate) async fn fire(
        &self,
        event: GgHookEvent,
        agent: &HookAgent,
        payload: Value,
        ctx: &ToolContext,
        offload: &OffloadPolicy,
        emitter: &Emitter,
    ) -> Result<HookRun, HookFailure> {
        let Some(hooks) = self.by_event.get(&event) else {
            return Ok(HookRun::default());
        };
        let mut run = HookRun::default();
        for hook in hooks {
            let outcome = self
                .run_one(hook, agent, &payload, ctx, offload, emitter)
                .await?;
            match outcome {
                GgHookOutcomeKind::Continue => {}
                GgHookOutcomeKind::Message { message } => {
                    let message = message.trim();
                    if message.is_empty() {
                        continue;
                    }
                    if !event.can_insert() {
                        // Reported rather than dropped: the hook did its job and gg cannot honor
                        // it, which is a fact about the configuration its author needs to hear.
                        emitter.emit(GgTelemetryKind::Log {
                            level: "warn".to_string(),
                            message: format!(
                                "hook `{}` returned a message on `{}`, which has no prompt to \
                                 insert into; the message is dropped.",
                                hook.label,
                                event.as_str(),
                            ),
                        });
                        continue;
                    }
                    run.messages.push(message.to_string());
                }
                GgHookOutcomeKind::Block { reason } => {
                    if !event.can_block() {
                        emitter.emit(GgTelemetryKind::Log {
                            level: "warn".to_string(),
                            message: format!(
                                "hook `{}` blocked on `{}`, which cannot be blocked; the operation \
                                 proceeds.",
                                hook.label,
                                event.as_str(),
                            ),
                        });
                        continue;
                    }
                    emitter.emit(GgTelemetryKind::Log {
                        level: "info".to_string(),
                        message: format!(
                            "hook `{}` blocked `{}`: {reason}",
                            hook.label,
                            event.as_str(),
                        ),
                    });
                    run.blocked = Some(reason);
                    break;
                }
            }
        }
        Ok(run)
    }

    /// Run one hook and read its verdict.
    async fn run_one(
        &self,
        hook: &ResolvedHook,
        agent: &HookAgent,
        payload: &Value,
        ctx: &ToolContext,
        offload: &OffloadPolicy,
        emitter: &Emitter,
    ) -> Result<GgHookOutcomeKind, HookFailure> {
        match &hook.action {
            GgHookAction::Command {
                command,
                cwd,
                timeout_secs,
                output,
            } => Ok(run_command_hook(
                hook,
                command,
                cwd.as_deref(),
                *timeout_secs,
                output.as_deref(),
                ctx,
                offload,
                emitter,
            )
            .await),
            GgHookAction::BuiltIn { script } => {
                // Resolution proved the id, so an absent source here would be gg's catalogue
                // disagreeing with itself between launch and this call.
                let source = builtin_source(script).unwrap_or_default();
                self.run_script_hook(hook, source, agent, payload, ctx, emitter)
                    .await
            }
            GgHookAction::Custom { source } => {
                self.run_script_hook(hook, source, agent, payload, ctx, emitter)
                    .await
            }
        }
    }

    /// Run a script hook: materialize its source, hand it the event as one JSON argument, and read
    /// its decision off stdout.
    ///
    /// The script is written to `.gg/hooks/` and made executable, so a `#!` line chooses the
    /// interpreter and a script without one is run by `sh`. That is the whole of the interpreter
    /// story on purpose: gg has no business owning a language runtime for hooks when the run
    /// container already has every one the script's author might want, and a shebang is how every
    /// other tool in that container decides the same question.
    async fn run_script_hook(
        &self,
        hook: &ResolvedHook,
        source: &str,
        agent: &HookAgent,
        payload: &Value,
        ctx: &ToolContext,
        emitter: &Emitter,
    ) -> Result<GgHookOutcomeKind, HookFailure> {
        let path = self
            .materialize(hook, source)
            .map_err(|detail| HookFailure {
                hook: hook.label.clone(),
                detail,
            })?;
        let argument = event_payload(hook.event, agent, payload).to_string();
        // The script's own stdout is the verdict, so it is read whole rather than through the
        // agent's offloading policy: a truncated decision is an unparseable one, and a hook's
        // decision is never the megabyte a test suite's output is.
        let command = format!(
            "{} {}",
            shell_quote(&path.to_string_lossy()),
            shell_quote(&argument)
        );
        let outcome = run_command(
            &command,
            DEFAULT_HOOK_TIMEOUT,
            &OffloadPolicy::Inline,
            ctx,
            GgShellOrigin::Hook,
        )
        .await;
        if !outcome.ok {
            return Err(HookFailure {
                hook: hook.label.clone(),
                detail: format!(
                    "the script exited non-zero, so it judged nothing. Its output:\n{}",
                    outcome.output.trim(),
                ),
            });
        }
        parse_outcome(&outcome.output).map_err(|detail| {
            emitter.emit(GgTelemetryKind::Log {
                level: "error".to_string(),
                message: format!("hook `{}` printed an unreadable decision.", hook.label),
            });
            HookFailure {
                hook: hook.label.clone(),
                detail,
            }
        })
    }

    /// Write `source` to an executable file named for `hook`, returning its path.
    ///
    /// Idempotent by construction: the same hook writes the same path every firing, so a run with a
    /// pre-write hook does not accumulate a file per write.
    fn materialize(&self, hook: &ResolvedHook, source: &str) -> Result<PathBuf, String> {
        std::fs::create_dir_all(&self.scripts_dir)
            .map_err(|err| format!("could not create `{HOOK_SCRIPT_DIR}`: {err}"))?;
        let path = self.scripts_dir.join(script_filename(hook));
        std::fs::write(&path, source)
            .map_err(|err| format!("could not write the script to `{}`: {err}", path.display()))?;
        let mut permissions = std::fs::metadata(&path)
            .map_err(|err| format!("could not stat `{}`: {err}", path.display()))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions)
            .map_err(|err| format!("could not make `{}` executable: {err}", path.display()))?;
        Ok(path)
    }
}

/// Run a [command hook](GgHookAction::Command): a command line, an exit status, and its output
/// shown to the model either way.
///
/// The output is put in front of the model whether the command passed or failed, because a hook's
/// output is the whole of what it has to say and a run that only surfaced failures would make a
/// passing check invisible. A non-zero exit becomes a [block](GgHookOutcomeKind::Block) carrying
/// that same output, so the model reads *why* in the words of the thing that refused it.
#[allow(clippy::too_many_arguments)]
async fn run_command_hook(
    hook: &ResolvedHook,
    command: &str,
    cwd: Option<&str>,
    timeout_secs: Option<f64>,
    output_mode: Option<&str>,
    ctx: &ToolContext,
    offload: &OffloadPolicy,
    emitter: &Emitter,
) -> GgHookOutcomeKind {
    let timeout = timeout_secs
        .filter(|secs| secs.is_finite() && *secs > 0.0)
        .map(Duration::from_secs_f64)
        .unwrap_or(DEFAULT_HOOK_TIMEOUT);
    // A hook that declares no output mode follows the agent's own `shell` configuration, which is
    // almost always what an operator means: the reason a run offloads its command output is that
    // its commands are noisy, and a hook running `npm test` is the noisiest of them.
    let policy = match output_mode {
        Some(mode) => OffloadPolicy::for_mode(mode, offload),
        None => offload.clone(),
    };
    // Derived from the agent's context rather than built fresh, so a hook that declares a `cwd`
    // still runs through *this agent's* shell runner and is still attributed to the agent whose
    // operation it is gating.
    let ctx = match cwd {
        None => ctx.clone(),
        Some(dir) => {
            let path = Path::new(dir);
            let rooted = if path.is_absolute() {
                path.to_path_buf()
            } else {
                ctx.workspace_dir.join(path)
            };
            ctx.rooted_at(rooted)
        }
    };
    let outcome = run_command(command, timeout, &policy, &ctx, GgShellOrigin::Hook).await;
    if outcome.ok {
        emitter.emit(GgTelemetryKind::Log {
            level: "info".to_string(),
            message: format!("hook `{}` passed: `{command}`", hook.label),
        });
        let body = outcome.output.trim();
        return if body.is_empty() {
            GgHookOutcomeKind::Continue
        } else {
            GgHookOutcomeKind::Message {
                message: format!("`{command}` (hook `{}`)\n{body}", hook.label),
            }
        };
    }
    emitter.emit(GgTelemetryKind::Log {
        level: "warn".to_string(),
        message: format!("hook `{}` failed: `{command}`", hook.label),
    });
    GgHookOutcomeKind::Block {
        reason: format!(
            "`{command}` (hook `{}`) exited non-zero:\n{}",
            hook.label,
            outcome.output.trim(),
        ),
    }
}

/// The full JSON one script hook is handed: the [agent facts](HookAgent) every event carries, the
/// event's own name, and the event-specific payload merged in beside them.
///
/// Merged rather than nested under a `payload` key so a script reads `argv[1]`'s `path` directly
/// instead of `payload.path` — the payload's fields are the event, and a wrapper would be a level
/// of indirection every script pays for and none of them wants.
fn event_payload(event: GgHookEvent, agent: &HookAgent, payload: &Value) -> Value {
    let mut map = agent.to_json();
    map.insert("event".into(), json!(event.as_str()));
    if let Some(fields) = payload.as_object() {
        for (key, value) in fields {
            map.insert(key.clone(), value.clone());
        }
    }
    Value::Object(map)
}

/// Read a script's stdout as a [decision](GgHookOutcomeKind), or say why it could not be read.
///
/// Only the **last** non-empty line is parsed, so a script that logged its way to a decision — the
/// natural way to write one — is not punished for it. Anything else is a failure rather than a
/// default, on the rule the module doc gives.
fn parse_outcome(stdout: &str) -> Result<GgHookOutcomeKind, String> {
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .ok_or_else(|| {
            "the script printed nothing. A hook script must print one decision object, such as \
             `{\"action\":\"continue\"}`."
                .to_string()
        })?;
    serde_json::from_str::<GgHookOutcomeKind>(line).map_err(|err| {
        format!(
            "the script's last line of output is not a decision object ({err}). Print one of \
             `{{\"action\":\"continue\"}}`, `{{\"action\":\"block\",\"reason\":\"…\"}}`, or \
             `{{\"action\":\"message\",\"message\":\"…\"}}`. It printed: {line}"
        )
    })
}

/// How a hook reads in a diagnostic: its operator-given name, else what it runs, else its position.
fn hook_label(hook: &GgHook, index: usize) -> String {
    let name = hook.name.trim();
    if !name.is_empty() {
        return name.to_string();
    }
    match &hook.action {
        GgHookAction::Command { command, .. } => command.trim().to_string(),
        GgHookAction::BuiltIn { script } => script.trim().to_string(),
        GgHookAction::Custom { .. } => format!("{} #{}", hook.event.as_str(), index + 1),
    }
}

/// The filename a hook's script is materialized under — its event and its position among that
/// event's hooks, sanitized. Stable across firings, so the file is rewritten rather than multiplied.
fn script_filename(hook: &ResolvedHook) -> String {
    let slug: String = hook
        .label
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    format!("{}-{}", hook.event.as_str(), slug.trim_matches('-'))
}

/// Quote one argument for `sh -c`.
///
/// Single quotes with the standard `'\''` escape, which is total over arbitrary bytes — and it has
/// to be, because one of the two arguments gg quotes here is a JSON document containing whatever
/// the model just tried to write to a file.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
#[path = "hooks.test.rs"]
mod tests;
