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
//! Everything else gg configures is a capability: a feature the model is offered, and one that
//! two configurations being compared may differ over. A hook is the opposite end of the telescope — the operator reaching in from outside the
//! run. The model is never told a hook exists, is offered no tool for one, and cannot decline one;
//! a blocked write comes back looking like a refusal from the harness, because that is what it is.
//! They never appear in the `cap.*` query namespace.
//!
//! # Where a hook is declared
//!
//! A hook's [event](GgHookEvent) decides which of two lists it belongs to, and nothing else does:
//!
//!  * The two [session events](test_cabinet_core::gg::SESSION_HOOK_EVENTS) fire once per run,
//!    around the root's session as a whole, and are declared on the run
//!    ([`GgCapabilitySet::hooks`]).
//!  * The other eight ([`AGENT_HOOK_EVENTS`](test_cabinet_core::gg::AGENT_HOOK_EVENTS)) fire
//!    because a *particular agent* wrote a file, ran a command, filled its window, started or
//!    tried to stop — and are declared on that
//!    [agent](test_cabinet_core::gg::GgAgentConfig::hooks).
//!
//! The agent half is per profile because the agents of a run are not interchangeable. "The build
//! must pass before you may stop" is right for an implementer, pointless for a planner, and wrong
//! for a reviewer whose job is to report that the build does not pass. Declared once for the run,
//! every such gate would fire for every agent and each one would have to decide from the agent
//! identity in its payload whether it had been meant to fire at all — which is a filter an operator
//! writes in a script instead of writing in the configuration.
//!
//! A hook declared in the other list's place [fails the launch](HookRuntime::resolve) rather than
//! being hoisted or pushed down: both guesses silently change which agents a gate holds.
//!
//! An ending gate is one of these. The validation an agent must pass before it may stop is an
//! [agent-stop](GgHookEvent::AgentStop) [command hook](GgHookAction::Command) — declared on
//! whichever profiles should be held to it, and free to be a script when a run wants more than an
//! exit code to decide with.
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
//! A command hook **names its own ceiling**. How long a build or a test suite may run before it is
//! worth killing is a property of the workspace and gg knows nothing about it, so `timeoutSecs` is
//! [required](check_timeout) and gg supplies none. Its `output` and its `cwd` are the opposite case
//! and stay optional: absent, the first follows the agent's own shell configuration and the second
//! runs the command in the agent's workspace root — inheritance from the agent being gated, not a
//! figure gg chose.
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
    GG_BUILTIN_HOOKS, GgAgentConfig, GgCapabilitySet, GgHook, GgHookAction, GgHookAgentKind,
    GgHookEvent, GgHookOutcomeKind, GgTelemetryKind,
};
use test_cabinet_core::gg_session_record::GgShellOrigin;

use crate::telemetry::Emitter;
use crate::tools::{OffloadPolicy, ToolContext, run_command};

#[path = "hooks.builtin.rs"]
mod builtin;

pub(crate) use builtin::builtin_source;

/// The ceiling gg runs **its own script hooks** under — a fixed constant, with no option behind it
/// for it to stand in for.
///
/// A script hook is not a build: it is handed the event as one JSON argument and prints one decision
/// object, so what it needs is enough time to read the workspace and answer, and this is generous
/// against that. A [command hook](GgHookAction::Command) is the other thing entirely — an arbitrary
/// build or test suite whose ceiling is nobody's to guess — so it
/// [names its own](GgHookAction::Command::timeout_secs) and gg never supplies one.
const SCRIPT_HOOK_TIMEOUT: Duration = Duration::from_secs(300);

/// The ceiling [`run_command_hook`] runs under when a command hook declares no
/// [`timeoutSecs`](GgHookAction::Command::timeout_secs) — a hook the
/// [launch pass](check_timeout) has already refused the run over, so nothing gg conducts reaches
/// this.
///
/// **Zero**, and zero rather than a figure because a hook whose ceiling nobody wrote gates nothing:
/// the command is killed at once, in the only way that cannot be mistaken for a gate that ran. A
/// length of time gg chose is exactly what the refusal exists to prevent.
const TIMEOUT_OF_A_REFUSED_HOOK: Duration = Duration::ZERO;

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
/// Every payload carries these even now that an agent event's hooks are the agent's own, because
/// knowing the *profile* is not knowing the *instance*: a profile can be running a dozen times at
/// once, and a script asked to decide about a write has no other way to tell which of them is
/// writing, or whether that instance is working in an isolated worktree where the path it is being
/// shown means something different from the same path in the main tree.
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

/// Which of a configuration's two declaration sites a [`HookRuntime`] is being built from.
///
/// It carries the two things resolution needs of a site and nothing else: which half of the event
/// space belongs there, and how to name the site in an error an operator has to act on.
#[derive(Debug, Clone, Copy)]
enum HookOwner<'a> {
    /// The run itself — [`GgCapabilitySet::hooks`].
    Session,
    /// One agent profile, by [id](GgAgentConfig::id) — [`GgAgentConfig::hooks`].
    Agent(&'a str),
}

impl HookOwner<'_> {
    /// Whether this site is the one [session events](GgHookEvent::is_session) belong to.
    fn wants_session(self) -> bool {
        matches!(self, Self::Session)
    }

    /// The subdirectory of [`HOOK_SCRIPT_DIR`] this site's scripts are materialized into.
    ///
    /// Sanitized rather than used raw because a profile id is only *minted* as a slug — an
    /// operator may write any non-empty string — and this is a path component; `Session` cannot
    /// collide with a profile because the slug of a profile whose id is `session` is
    /// `agent-session`.
    fn dir_slug(self) -> String {
        match self {
            Self::Session => "session".to_string(),
            Self::Agent(id) => {
                let slug: String = id
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
                    .collect();
                format!("agent-{}", slug.trim_matches('-'))
            }
        }
    }

    /// One of [`problems`]'s sentences as a standalone line: which hook, and — for an agent's site
    /// — whose.
    ///
    /// Only [`resolve`](HookRuntime::resolve) needs this. The
    /// [launch pass](crate::validate::validate_launch) carries the same two facts structurally, in
    /// the [defect](crate::validate::LaunchDefect)'s agent and locus, and would print them twice.
    fn attribute(self, label: &str, message: &str) -> String {
        match self {
            Self::Session => format!("hook `{label}`: {message}"),
            Self::Agent(name) => format!("agent `{name}`: hook `{label}`: {message}"),
        }
    }

    /// The error for a hook declared here whose event belongs to the other site — phrased as the
    /// move that fixes it, since "wrong place" is only useful beside the right one.
    ///
    /// The sentence names neither the hook nor the agent: both are attribution, and both are
    /// carried by whatever reports it — a [`LaunchDefect`](crate::validate::LaunchDefect)'s agent
    /// and locus at launch, [`resolve`](HookRuntime::resolve)'s own prefix in the gg-defect string
    /// it builds.
    fn misplaced(self, event: GgHookEvent) -> String {
        match self {
            Self::Session => format!(
                "`{}` fires for a particular agent, so it is declared on an agent rather than on \
                 the run. Move it to the agent (or agents) it should hold.",
                event.as_str(),
            ),
            Self::Agent(_) => format!(
                "`{}` happens once per run rather than for any one agent. Move it to the \
                 configuration's own hooks.",
                event.as_str(),
            ),
        }
    }
}

/// One declaration site's hooks, grouped by the event they fire on.
///
/// A run resolves several of these: one for [the session](GgCapabilitySet::hooks) and one per
/// [agent profile](GgAgentConfig::hooks). Grouping by event is what makes the common case — an
/// event with no hooks on it, which is most events of most runs — a map lookup that finds nothing,
/// rather than a walk of every hook per file write.
#[derive(Debug)]
pub(crate) struct HookRuntime {
    /// The hooks on each event, in declaration order.
    by_event: BTreeMap<GgHookEvent, Vec<ResolvedHook>>,
    /// Where a script hook's source is written before it is run — under the run's workspace, in a
    /// subdirectory of this declaration site's own.
    scripts_dir: PathBuf,
}

impl HookRuntime {
    /// The hooks of a declaration site **the set does not declare** — no hooks, on no event.
    ///
    /// Reached only where a profile id has no entry in the run's per-profile hook map, which is a
    /// profile the set does not carry and the dispatcher has already refused. It is named rather
    /// than reached through `Default` because a gate that silently does not run is worse than no
    /// gate: the name is what says this site declared nothing, as against a site whose declarations
    /// were dropped.
    pub(crate) fn undeclared() -> Self {
        Self {
            by_event: BTreeMap::new(),
            scripts_dir: PathBuf::new(),
        }
    }

    /// Resolve the run's [session hooks](GgCapabilitySet::hooks) against `workspace_dir`.
    pub(crate) fn resolve_session(
        set: &GgCapabilitySet,
        workspace_dir: &Path,
    ) -> Result<Self, Vec<String>> {
        Self::resolve(&set.hooks, HookOwner::Session, workspace_dir)
    }

    /// Resolve one profile's [agent hooks](GgAgentConfig::hooks) against `workspace_dir`.
    pub(crate) fn resolve_agent(
        agent: &GgAgentConfig,
        workspace_dir: &Path,
    ) -> Result<Self, Vec<String>> {
        Self::resolve(&agent.hooks, HookOwner::Agent(&agent.slug), workspace_dir)
    }

    /// Resolve one declaration site's hooks, or report the configuration errors that stop the run.
    ///
    /// The errors are [`problems`]'s, one string apiece with the hook named — and getting here with
    /// any of them means the [launch pass](crate::validate::validate_launch) accepted a document
    /// this reads as unresolvable, which is a **gg defect**. The caller says so in those words and
    /// ends the session: a declaration site whose hooks were dropped is a run whose gates are not
    /// there, and a gate that silently does not run is worse than no gate because an operator
    /// believes they have one.
    fn resolve(
        hooks: &[GgHook],
        owner: HookOwner<'_>,
        workspace_dir: &Path,
    ) -> Result<Self, Vec<String>> {
        let problems = problems(hooks, owner);
        if !problems.is_empty() {
            return Err(problems
                .into_iter()
                .map(|(label, message)| owner.attribute(&label, &message))
                .collect());
        }
        let mut by_event: BTreeMap<GgHookEvent, Vec<ResolvedHook>> = BTreeMap::new();
        for (index, hook) in hooks.iter().enumerate() {
            by_event.entry(hook.event).or_default().push(ResolvedHook {
                label: hook_label(hook, index),
                action: hook.action.clone(),
                event: hook.event,
            });
        }
        Ok(Self {
            by_event,
            // Each declaration site materializes into its own directory. Two profiles may name a
            // hook the same thing and mean different scripts, and [script_filename] is derived from
            // the label — so without this they would write the same path and each firing would run
            // whichever agent wrote it last.
            scripts_dir: workspace_dir.join(HOOK_SCRIPT_DIR).join(owner.dir_slug()),
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
                // Resolution proved the id, so an absent source here is gg's catalogue disagreeing
                // with itself between launch and this call. Running an empty script instead would
                // print no decision and end the run one layer further down, saying nothing about
                // which of the two things went wrong.
                let Some(source) = builtin_source(script) else {
                    return Err(HookFailure {
                        hook: hook.label.clone(),
                        detail: format!(
                            "gg ships no source for the built-in `{script}`, which the launch \
                             pass accepted (gg defect)"
                        ),
                    });
                };
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
            SCRIPT_HOOK_TIMEOUT,
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
///
/// Three of the declaration's fields are read here, and they are read three different ways.
/// `timeout_secs` is the hook's own and gg supplies none: the declared figure is what the command
/// runs under, and a hook that declared none has already [refused the launch](check_timeout).
/// `output_mode` and `cwd` are **inheritance rather than substitution** — absent, the command's
/// output follows the agent's own [shell configuration](OffloadPolicy) and the command runs in the
/// agent's workspace root. Neither absence is gg choosing a figure: each is the hook declining to
/// differ from the agent it is gating, which is a setting an operator can mean and a value gg is not
/// standing in for.
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
    // The declared ceiling, read as it was written. The launch pass proved it is there and that it
    // is a positive, finite number of seconds, so the placeholder below stands for a run that was
    // never started rather than for a hook gg decided a ceiling for.
    let timeout = match timeout_secs {
        Some(secs) if secs.is_finite() && secs > 0.0 => Duration::from_secs_f64(secs),
        _ => TIMEOUT_OF_A_REFUSED_HOOK,
    };
    // A hook that declares no output mode follows the agent's own `shell` configuration, which is
    // almost always what an operator means: the reason a run offloads its command output is that
    // its commands are noisy, and a hook running `npm test` is the noisiest of them. Inheritance,
    // not a substituted figure — the mode the output lands under is the one the agent is already
    // running.
    let policy = match output_mode {
        // A discarding sink: the launch pass read every hook's `output` through this same resolver
        // and refused the run if any named a mode gg does not have.
        Some(mode) => OffloadPolicy::for_mode(
            mode,
            offload,
            &hook_output_locus(&hook.label),
            &mut crate::validate::LaunchReport::Discarding,
        ),
        None => offload.clone(),
    };
    // Derived from the agent's context rather than built fresh, so a hook that declares a `cwd`
    // still runs through *this agent's* shell runner and is still attributed to the agent whose
    // operation it is gating. An absent `cwd` inherits that context whole, which is the agent's
    // workspace root — its worktree, for an agent working in one.
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

/// **Every hook on one declaration site gg could not arm**, each as its [label](hook_label) and the
/// sentence that says what to do about it.
///
/// Two things can be wrong with a hook's declaration, and both **refuse the launch** rather than
/// being skipped, on the rule a gate has to follow: a hook that silently does not run is worse than
/// no hook, because an operator believes they have one. Worse still is what a *skipped site* used to
/// mean — one typo'd built-in id disarmed every other hook declared beside it, including the
/// blocking `pre-write`, `pre-shell` and `agent-stop` gates.
///
///  * A [built-in](GgHookAction::BuiltIn) naming a script gg does not ship.
///  * A hook declared in the wrong place for its event — a session event on an agent, or an agent
///    event on the run. gg could guess what was meant in either direction, and both guesses are
///    wrong often enough to be worse than the refusal: a `pre-write` hook hoisted to the run would
///    gate agents its author never named, and a `session-end` hook pushed down to an agent would
///    fire once per profile, or not at all.
///
/// Every offending hook is returned, not the first: an operator fixing a document wants the whole
/// list.
fn problems(hooks: &[GgHook], owner: HookOwner<'_>) -> Vec<(String, String)> {
    let mut problems = Vec::new();
    for (index, hook) in hooks.iter().enumerate() {
        let label = hook_label(hook, index);
        if hook.event.is_session() != owner.wants_session() {
            problems.push((label, owner.misplaced(hook.event)));
            continue;
        }
        if let GgHookAction::BuiltIn { script } = &hook.action
            && builtin_source(script).is_none()
        {
            problems.push((
                label,
                format!(
                    "`{script}` is not a built-in hook script. gg ships: {}.",
                    GG_BUILTIN_HOOKS.join(", "),
                ),
            ));
        }
    }
    problems
}

/// Where one hook sits in the configuration document, keyed by its [label](hook_label).
fn hook_locus(label: &str) -> String {
    format!("hooks[{label}]")
}

/// Where one hook's [`output`](GgHookAction::Command::output) override sits in the configuration
/// document, keyed by the hook's [label](ResolvedHook::label) rather than by its index.
///
/// The label is what every other diagnostic about a hook names and what an operator recognises; the
/// index is a number they would have to count out. The launch check and the firing site build the
/// locus the same way, from the same label, so a refusal and a mid-run assertion name one place.
fn hook_output_locus(label: &str) -> String {
    format!("hooks[{label}].output")
}

/// The hooks' contribution to the [launch pass](crate::validate::validate_launch), on the run's own
/// [session hooks](GgCapabilitySet::hooks) and on every profile's
/// [agent hooks](GgAgentConfig::hooks) alike:
///
///  * every declaration [`resolve`](HookRuntime::resolve) would refuse — see [`problems`];
///  * every [`output`](GgHookAction::Command::output) override, the one hook field resolution does
///    not judge. Resolution proves the *shape* of a declaration and leaves the command's own fields
///    to the things that read them; `output` is read by the shell's
///    [offload policy](OffloadPolicy::for_mode), and until this check existed it was read there with
///    no launch diagnostic anywhere behind it.
///
/// The first group is what makes the hooks contract true rather than aspirational: `resolve` has
/// always returned these as errors, and the launch is what acts on them. By the time a runtime is
/// built the pass has already proved there are none, so `resolve`'s `Err` there is a gg defect.
///
/// A session hook's defect is run-level and an agent hook's is attributed to its profile, because
/// that is where an operator has to go and edit it.
pub fn check_launch(set: &GgCapabilitySet, report: &mut crate::validate::LaunchReport) {
    for (label, message) in problems(&set.hooks, HookOwner::Session) {
        report.report(crate::validate::LaunchDefect::run_level(
            hook_locus(&label),
            "",
            message,
        ));
    }
    check_actions(&set.hooks, &hook_offload(set.root()), report);
    for profile in &set.agents {
        report.for_agent(&profile.slug, |report| {
            for (label, message) in problems(&profile.hooks, HookOwner::Agent(&profile.slug)) {
                report.report(crate::validate::LaunchDefect::run_level(
                    hook_locus(&label),
                    "",
                    message,
                ));
            }
            check_actions(&profile.hooks, &hook_offload(profile), report);
        });
    }
}

/// The [output policy](OffloadPolicy) `profile`'s hooks run under — its own `shell` configuration,
/// which is what [`run_command_hook`] is handed and what an `output` override is measured against.
/// A session hook is fired on the root's behalf, so the root's is the one that governs it.
///
/// Read through [`already_reported`](crate::validate::LaunchReport::already_reported): every defect
/// this capability carries belongs to [`shell::check_launch`](crate::tools::check_launch), which
/// reads it at its own loci in this same pass, and a refusal names each value once.
fn hook_offload(profile: &GgAgentConfig) -> OffloadPolicy {
    crate::tools::shell_offload(
        profile,
        &mut crate::validate::LaunchReport::already_reported(),
    )
}

/// Every field of one declaration site's hook **actions** that gg reads and could fail to honour:
/// the [`output`](GgHookAction::Command::output) mode, the
/// [`timeoutSecs`](GgHookAction::Command::timeout_secs) ceiling, and the two ways an action can name
/// nothing to run at all.
///
/// [`problems`] proves a hook is *declared* in a place gg can arm it. This proves the action itself
/// is one gg can perform, which is the other half of "a hook that silently does not run is worse
/// than no hook": a hook armed on a blank command line runs `sh -c '   '`, exits 0 and prints
/// nothing, which is a `pre-write` gate that always passes.
fn check_actions(
    hooks: &[GgHook],
    offload: &OffloadPolicy,
    report: &mut crate::validate::LaunchReport,
) {
    for (index, hook) in hooks.iter().enumerate() {
        let label = hook_label(hook, index);
        match &hook.action {
            GgHookAction::Command {
                command,
                timeout_secs,
                output,
                ..
            } => {
                if command.trim().is_empty() {
                    report.report(crate::validate::LaunchDefect::run_level(
                        format!("hooks[{label}].command"),
                        command.clone(),
                        "a command hook runs a command line, and this one is blank".to_string(),
                    ));
                }
                check_timeout(&label, *timeout_secs, report);
                // Read exactly as `run_command_hook` reads it, against the policy that call will
                // hand it: an `output` override names the **mode**, and the ceilings a truncating
                // one measures its tail against are the agent's own — so a hook that asks for a
                // tail on an agent whose `shell` declares none is a hook gg cannot run as written.
                if let Some(mode) = output {
                    OffloadPolicy::for_mode(mode, offload, &hook_output_locus(&label), report);
                }
            }
            GgHookAction::Custom { source } => {
                if source.trim().is_empty() {
                    report.report(crate::validate::LaunchDefect::run_level(
                        format!("hooks[{label}].source"),
                        "",
                        "a custom hook is the script the configuration carries, and this one \
                         carries none; gg would write an empty file, run it, and end the run \
                         because it printed no decision — on the first operation the hook gates."
                            .to_string(),
                    ));
                }
            }
            GgHookAction::BuiltIn { .. } => {}
        }
    }
}

/// One command hook's [`timeoutSecs`](GgHookAction::Command::timeout_secs), read exactly as
/// [`run_command_hook`] reads it.
///
/// **Required.** How long a build or a test suite may run before it is worth killing is a property
/// of the workspace, and gg knows nothing about it: a hook killed at a figure gg picked reports a
/// failure the workspace did not have, and reports it as the gate's own verdict. So an absent
/// ceiling refuses the launch rather than being filled in.
///
/// A declared one that is not a positive, finite number of seconds is refused on the same terms —
/// `0` and a negative name no length of time, and an operator who wrote one to make a gate fail fast
/// has written something gg cannot run under.
fn check_timeout(
    label: &str,
    timeout_secs: Option<f64>,
    report: &mut crate::validate::LaunchReport,
) {
    let locus = || format!("hooks[{label}].timeoutSecs");
    let Some(secs) = timeout_secs else {
        report.report(crate::validate::LaunchDefect::run_level(
            locus(),
            "",
            "a command hook names how long its command may run before it is killed, and this \
             one names none"
                .to_string(),
        ));
        return;
    };
    if secs.is_finite() && secs > 0.0 {
        return;
    }
    report.report(crate::validate::LaunchDefect::run_level(
        locus(),
        format!("{secs}"),
        "a hook's `timeoutSecs` is how long its command may run before it is killed, so it must \
         be a positive number of seconds"
            .to_string(),
    ));
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
