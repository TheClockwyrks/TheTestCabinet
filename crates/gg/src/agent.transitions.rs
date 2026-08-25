//! **Succession**: how one agent instance becomes another — the shared half of a machine
//! [transition](crate::fsm), an `exec`, and a `fork`.
//!
//! All three are the same operation over [modules](crate::modules) — carry these, drop those,
//! initialize the rest — and they differ in exactly two things: who chose the successor, and what
//! happens to the predecessor.
//!
//! | | Chosen by | The predecessor | The successor |
//! | --- | --- | --- | --- |
//! | [transition](handle_transition) | the machine's declared edge | ends | the same agent, in the next state |
//! | [`exec`](handle_exec) | the model, from its own roster | ends | the same agent, under another profile |
//! | [`fork`](handle_fork) | the model | **keeps running** | a *child*, one level deeper |
//!
//! So a transition and an `exec` both produce a [`Handoff`], which [`run_agent`]'s incarnation loop
//! applies: it drains the outgoing instance's modules, [transfers](crate::modules::transfer) what
//! the plan carries, mints the successor, and drives it on the very same scheduler slot. A `fork`
//! produces a [`PendingFork`] instead, which the loop turns into an ordinary spawned child whose
//! modules are [clones](crate::modules::fork_modules) of the forker's rather than a fresh set.
//!
//! It is a module of [`agent`](super) rather than a file of it for the same reason
//! [the code path](super::code) is: one self-contained concern of some size, split out under the
//! repo's `foo.<concern>.rs` convention because `agent.rs` is already the largest file in the
//! crate. Its items are `use`d back into [`agent`](super), so the loop names them unqualified.
//!
//! # Every one of them is turn-final
//!
//! A call here **declares**; the loop **applies**, once every tool result of the turn has been
//! recorded. That is not a convenience: a window rewritten (or copied) mid-turn would carry an
//! assistant `tool_calls` message whose answering `tool` messages had not been written yet, which
//! an OpenAI-shaped provider rejects outright — and under
//! [responses-as-code](crate::sandbox) it would pull the very window a running program is composing
//! into out from under it. Deferring costs nothing the model can perceive beyond one sentence in
//! each tool's description, and it is what makes the thread a successor inherits a valid one.
//!
//! The consequence worth knowing is that a fork cannot be waited on in the turn that created it:
//! its id is real (it is minted at the call, so the tool result can name it), but it is not a child
//! until the turn ends. Both tool descriptions say so.
//!
//! # First declaration wins
//!
//! A turn that declares two successions keeps the first and refuses the second, and an ending beats
//! both. Unlike a [compaction] — which is idempotent, so a second `compact` harmlessly replaces the
//! first — a silently replaced successor identity is a change the model cannot see, and an agent
//! that said its work was done has nothing left to hand on. Forks are the exception: they are
//! additive (each is a separate child), so a turn may declare several.

use super::*;

use std::collections::BTreeSet;

use test_cabinet_core::gg::{
    CAPABILITY_EXEC, CAPABILITY_FORK, GgRosterEntry, GgSubagentScope, GgTelemetryKind,
};

use crate::programs::ProgramLibrary;
use crate::tools::{EXEC_TOOL, FORK_TOOL};

// ---------------------------------------------------------------------------
// What a succession is
// ---------------------------------------------------------------------------

/// A **succession**: one agent instance ending so another may continue in its place.
///
/// It is what a [`transition_state`](TRANSITION_STATE_TOOL) call and an [`exec`](EXEC_TOOL) call
/// both turn into — deliberately one value rather than two, because the two features differ only in
/// the [plan](TransferPlan) they carry and in whether a machine position travels with them.
///
/// The loop that applies it is in [`run_agent`].
pub(super) struct Handoff {
    /// The [agent profile](GgAgentConfig) the successor runs under.
    ///
    /// It may name an [FSM shell](crate::fsm::is_shell), which is how a plain agent hands its work
    /// to a declared process: the loop enters the machine at its entry state and the successor runs
    /// *that state's* agent. A machine transition never names one — a shell cannot be a state.
    pub(super) profile: String,
    /// What the successor inherits.
    pub(super) plan: TransferPlan,
    /// The successor's opening message — what the predecessor wanted it to know. Folded into the
    /// note gg writes about the handoff itself, so a successor is never left inferring what it
    /// received from an empty task list.
    pub(super) message: Option<String>,
    /// Why the succession happened, which is what the console renders it as.
    pub(super) reason: HandoffReason,
    /// The machine position the successor occupies. `Some` for a machine transition; `None` for an
    /// `exec`, which the loop replaces with a machine's entry position when the target turns out to
    /// be a shell.
    pub(super) fsm: Option<FsmPosition>,
    /// The predecessor's [program library](crate::programs), which a succession **moves** to the
    /// successor: entries and issued ids together, so the successor can fetch the program its
    /// predecessor wrote and never re-issues an id it once handed out.
    ///
    /// Declared [disabled](ProgramLibrary::disabled) — the call that declares a handoff is made from
    /// inside a turn, where the library is on the other side of the api — and
    /// [attached](Self::carrying) by the loop as the incarnation ends, where the library is in hand.
    pub(super) programs: ProgramLibrary,
}

/// Why one agent instance handed off to another — the gg-side half of [`GgAgentTransitionKind`].
pub(super) enum HandoffReason {
    /// A [machine](crate::fsm) moved from one state to the next.
    Fsm {
        /// The state the machine left, for the transition telemetry and the successor's note.
        from: String,
    },
    /// The agent replaced itself with another profile of its own choosing.
    Exec {
        /// The [id](GgAgentConfig::id) of the profile the predecessor was running, for the
        /// successor's note. The predecessor *instance*'s id is already on the successor as its
        /// `parent_id`; what the note needs is the profile whose conversation it is reading.
        from: String,
    },
}

impl Handoff {
    /// This handoff carrying the outgoing incarnation's [program library](crate::programs) to its
    /// successor.
    pub(super) fn carrying(mut self, programs: ProgramLibrary) -> Self {
        self.programs = programs;
        self
    }

    /// How this handoff names its destination in a refusal: the machine state when it has one, and
    /// the successor's profile otherwise.
    fn profile_state(&self) -> &str {
        match self.fsm.as_ref() {
            Some(position) => position.state(),
            None => &self.profile,
        }
    }
}

impl HandoffReason {
    /// How this succession is reported on the wire.
    pub(super) fn kind(&self) -> GgAgentTransitionKind {
        match self {
            HandoffReason::Fsm { .. } => GgAgentTransitionKind::Fsm,
            HandoffReason::Exec { .. } => GgAgentTransitionKind::Exec,
        }
    }

    /// The [machine](crate::fsm) state the predecessor stood in, for the successor's own
    /// [`FsmState`](GgTelemetryKind::FsmState) event. `None` outside a machine — including for an
    /// `exec` that *enters* one, whose successor is standing in an entry state and came from
    /// nowhere within it.
    pub(super) fn departed_state(&self) -> Option<String> {
        match self {
            HandoffReason::Fsm { from } => Some(from.clone()),
            HandoffReason::Exec { .. } => None,
        }
    }
}

/// What one incarnation of an agent hands to the next — and what a [fork](handle_fork) is handed at
/// its own first turn, which is the same thing from the other side of the boundary.
///
/// It is the whole of what crosses a succession: the modules (which are built on the *outgoing*
/// side of the boundary, while its stream is still live to report what was carried), the note the
/// successor opens on, the state it came from, and how many turns the thread it is holding has
/// already spent.
pub(super) struct Succession {
    /// The successor's modules, already [transferred](crate::modules::transfer) — or, for a fork,
    /// [cloned](crate::modules::fork_modules) — and re-resolved against its own profile.
    pub(super) modules: ModuleSet,
    /// The successor's [opening note](Opening::Carried).
    pub(super) note: String,
    /// Whether the [history](crate::modules::ModuleKind::History) module travelled with the
    /// succession — what [`Opening::Carried::history`] is built from. A fork always carries one;
    /// an FSM edge carries one only if its transfer list says so.
    pub(super) history: bool,
    /// The [machine](crate::fsm) state the predecessor was in, for the successor's own
    /// [`FsmState`](GgTelemetryKind::FsmState) event. `None` for a succession outside a machine.
    pub(super) from_state: Option<String>,
    /// The [program library](crate::programs) the successor [adopts](ProgramLibrary::adopt):
    /// **moved** from the predecessor by an exec or a machine edge, **cloned** from the forker by a
    /// fork. It is not a module — nothing in a transfer plan names it, and it is not reported in
    /// the opening note — but it crosses on the same terms as the modules do: the successor
    /// resolves its own retention and id length from its own profile and then adopts what was
    /// carried, and a successor whose profile disables the capability keeps nothing.
    pub(super) programs: ProgramLibrary,
    /// How many turns the thread in [`modules`](Self::modules) has already spent.
    ///
    /// It numbers the successor's turns continuously (a carried `Turn #37` still means turn 37, so
    /// an `archive_thread` naming it still resolves) and makes a succession spend **one** turn
    /// ceiling across its incarnations rather than one each. A fork inherits its forker's count for
    /// the first reason and accepts the second: it is holding a thread somebody already paid for.
    pub(super) turn_base: usize,
}

/// How an incarnation's window is opened: fresh, or carried over from the instance it succeeds.
///
/// The distinction is only about the first few items of the window and the two things that seed it.
/// A [fresh](Self::Fresh) opening is what every agent has always had — the build prompt, any
/// autoloaded specifications, any file views a persistent profile left open. A
/// [carried](Self::Carried) one that received the [history](crate::modules::ModuleKind::History)
/// module already *has* a thread: its build prompt is left alone and the seeding is skipped,
/// because the window it would seed into is not empty.
///
/// Neither case says anything about the system prompt, because it is not part of a window's
/// opening items at all: it lives in a [slot](ContextModel::set_system) that renders first on every
/// request, arrives from a succession *empty* (a prompt states someone else's toolset, roster and
/// ending calls), and is set by the loop for every incarnation alike.
pub(super) enum Opening {
    /// A window with nothing in it yet.
    Fresh,
    /// A window transferred (or cloned) from another instance, with `note` appended at the tail:
    /// what this instance received, what it did not, and whatever the instance it came from wanted
    /// to tell it.
    Carried {
        /// The successor's opening note.
        note: String,
        /// Whether the [history](crate::modules::ModuleKind::History) module actually came with
        /// the succession.
        ///
        /// Always true for an [`exec`](handle_exec) and a [`fork`](handle_fork), whose plans carry
        /// every module both sides hold; false for the FSM edge that declares an empty transfer
        /// list — the deliberate hard reset — whose successor is handed a brand-new empty window
        /// and must therefore be seeded like a fresh agent rather than rebased onto a thread it
        /// does not have.
        history: bool,
    },
}

/// A [`fork`](FORK_TOOL) the current turn declared: the child's already-minted id and what it is
/// being told to do.
///
/// The id is minted at the **call** rather than at the dispatch so the tool result can name the
/// copy — a spawn that returns no handle is a spawn the model cannot address — while the dispatch
/// itself waits for the turn to end, so the window the copy inherits is a valid conversation rather
/// than one stopped between an assistant's tool calls and their results.
pub(super) struct PendingFork {
    /// The copy's agent id, already minted from the run's counter and already returned to the
    /// forker.
    pub(super) id: String,
    /// What the copy should do that its forker will not — its opening instructions, on top of the
    /// conversation it inherits.
    pub(super) prompt: String,
}

// ---------------------------------------------------------------------------
// Judging a declared succession
// ---------------------------------------------------------------------------

/// The two gates every succession passes once its target is known, or `None` when it may proceed.
///
/// Both are refusals in the vocabulary the model can act on, and both are shared by
/// [`transition_state`](handle_transition) and [`exec`](handle_exec) so a turn is judged the same
/// way whichever call it reached for — and, because both execution paths route through these two
/// functions, the same way whether it was a native tool call or a line of a program.
fn succession_gates(
    declared_ending: &Option<Ending>,
    declared: &Option<Handoff>,
    target: &str,
) -> Option<ToolOutcome> {
    if declared_ending.is_some() {
        return Some(ToolOutcome::failed(
            ToolFailure::Refused,
            format!("this session already ended this turn; `{target}` was not handed anything"),
        ));
    }
    if let Some(taken) = declared.as_ref() {
        return Some(ToolOutcome::failed(
            ToolFailure::Refused,
            format!(
                "this session was already handed to `{}` this turn",
                taken.profile_state(),
            ),
        ));
    }
    None
}

/// Turn a [`transition_state`](TRANSITION_STATE_TOOL) call into a captured [`Handoff`], or into the
/// model-facing refusal that says why it was not taken.
///
/// Three things can go wrong, and each is answered in the vocabulary the model can act on. A target
/// the current state does not declare is refused with the [legal ones](FsmPosition::legal_targets)
/// listed. A **second** succession in one turn is refused because the first already stands. And a
/// transition in a turn that has already declared an ending is refused because the ending wins.
///
/// Shared by both execution paths — the tool-calling dispatch and the program membrane's deferred
/// declaration — so a transition is judged by exactly the same rules whichever way it was asked for.
pub(super) fn handle_transition(
    position: &FsmPosition,
    declared_ending: &Option<Ending>,
    declared: &mut Option<Handoff>,
    call: &ToolCall,
) -> ToolOutcome {
    let state = match call.arguments.get("state").and_then(Value::as_str) {
        Some(state) if !state.trim().is_empty() => state,
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!(
                    "`{TRANSITION_STATE_TOOL}`: missing required argument `state`; expected one \
                     of: {}",
                    position.legal_targets()
                ),
            );
        }
    };
    if let Some(refusal) = succession_gates(declared_ending, declared, state) {
        return refusal;
    }
    let transition = match position.transition_to(state) {
        Ok(transition) => transition,
        Err(refusal) => return ToolOutcome::failed(ToolFailure::InvalidArgument, refusal),
    };
    let next = position.moved_to(transition);
    let target = next.state().to_string();
    let agent = next.agent_id().to_string();
    *declared = Some(Handoff {
        profile: agent.clone(),
        plan: TransferPlan::Explicit(transition.transfer.clone()),
        message: succession_message(call, "note"),
        reason: HandoffReason::Fsm {
            from: position.state().to_string(),
        },
        fsm: Some(next),
        programs: ProgramLibrary::disabled(),
    });
    ToolOutcome::ok(
        format!(
            "Moving to `{target}` once this turn's tool results are recorded; the `{agent}` agent \
             continues from there."
        ),
        format!("transition to {target} accepted"),
    )
}

/// Turn an [`exec`](EXEC_TOOL) call into a captured [`Handoff`], or into the model-facing refusal
/// that says why this agent is not becoming anything.
///
/// The target is validated against the agent's own [roster](GgRosterEntry) with the
/// [subagent](GgSubagentScope::Subagent) scope — the very allowlist a spawn is checked against,
/// because putting a profile to work is putting a profile to work and a fourth scope for "may be
/// exec'd into" would be contract surface earning nothing. Naming **yourself** is legal when your
/// roster admits you: it re-initializes the capabilities you both have, which is a deliberate
/// self-reset rather than a mistake.
///
/// An agent standing in a [machine](crate::fsm) state is refused outright, and is not offered the
/// tool in the first place: inside a process the next move is the process's decision, and an agent
/// that could walk out of its own machine would leave a run whose record says it was still in one.
pub(super) fn handle_exec(
    roster: &[GgRosterEntry],
    spawner: &Agent,
    declared_ending: &Option<Ending>,
    declared: &mut Option<Handoff>,
    call: &ToolCall,
) -> ToolOutcome {
    if let Some(position) = spawner.fsm.as_ref() {
        return ToolOutcome::failed(
            ToolFailure::Unavailable,
            format!(
                "`{EXEC_TOOL}` is not available inside a process (the `{state}` state of \
                 `{fsm}`); use `{TRANSITION_STATE_TOOL}`",
                state = position.state(),
                fsm = position.fsm(),
            ),
        );
    }
    let target = match resolve_roster_target(roster, &call.arguments) {
        Ok(target) => target,
        Err(refusal) => return refusal,
    };
    if let Some(refusal) = succession_gates(declared_ending, declared, &target) {
        return refusal;
    }
    *declared = Some(Handoff {
        profile: target.clone(),
        // Everything both profiles have. This is what makes the successor open on its
        // predecessor's whole conversation: history is a module every set holds.
        plan: TransferPlan::Intersection,
        message: succession_message(call, "prompt"),
        reason: HandoffReason::Exec {
            from: spawner.profile_id.clone(),
        },
        fsm: None,
        programs: ProgramLibrary::disabled(),
    });
    ToolOutcome::ok(
        format!(
            "Continuing as `{target}` once this turn's tool results are recorded. It picks up this \
             conversation, and its opening message says what else it received and what it did not."
        ),
        format!("exec into {target} accepted"),
    )
}

/// Register a [`fork`](FORK_TOOL) for the loop to dispatch when the turn ends, and hand the forker
/// the copy's id.
///
/// Everything that can refuse a fork is checked **here**, at the call, rather than at the dispatch:
/// the delegation runtime, the depth cap, and the model binding. A tool result that says a copy was
/// made has to be true, and the dispatch itself happens after the turn is over, where there is no
/// longer a tool result to answer with.
pub(super) fn handle_fork(
    sub: &mut SubagentContext,
    spawner: &Agent,
    declared: &mut Vec<PendingFork>,
    call: &ToolCall,
) -> ToolOutcome {
    let prompt = match call.arguments.get("prompt").and_then(Value::as_str) {
        Some(prompt) if !prompt.trim().is_empty() => prompt.trim().to_string(),
        _ => {
            return ToolOutcome::failed(
                ToolFailure::InvalidArgument,
                format!("`{FORK_TOOL}`: missing required argument `prompt`"),
            );
        }
    };
    let orch = &sub.orch;
    // The depth cap, on exactly the terms `dispatch_child` applies it: a fork is a child. A
    // *ceiling*, so `limit-exceeded` rather than `refused` — the request was well-formed, the run
    // simply has no room left below this agent.
    if spawner.depth >= orch.config.max_depth {
        return ToolOutcome::failed(
            ToolFailure::LimitExceeded,
            format!(
                "at the maximum delegation depth ({})",
                orch.config.max_depth
            ),
        );
    }
    // The copy runs the forker's own profile, so its binding is the forker's — resolved here purely
    // to fail *now* rather than after the turn, and to name the model in the answer.
    //
    // The one resolution in gg that goes through the **anonymous**
    // [`client_for`](crate::client::ClientFactory::client_for): nobody is binding a client here.
    // The copy does not exist yet (it is dispatched after the turn, through
    // [`dispatch_child`](super::dispatch_child), which resolves its own), and asking on the
    // forker's identity would draw a second client against the forker's own queue for a call that
    // only ever reads `model_id()`. A substituted factory answers this with an unbound client —
    // right model id, and an error on any completion — so the fork's answer stays true and no live
    // call is possible.
    let model_id = match profile_binding(&orch.caps, &spawner.profile_id)
        .map_err(|err| err.to_string())
        .and_then(|binding| {
            orch.factory
                .client_for(&binding)
                .map(|client| client.model_id().to_string())
                .map_err(|err| err.to_string())
        }) {
        Ok(model_id) => model_id,
        Err(err) => {
            return ToolOutcome::failed(
                ToolFailure::IoError,
                format!("this agent's own profile could not be resolved ({err})"),
            );
        }
    };
    let id = orch.next_agent_id();
    // A fork runs its forker's own profile, so it is named the same way the forker is.
    let label = orch.caps.agent_name(&spawner.profile_id).to_string();
    declared.push(PendingFork {
        id: id.clone(),
        prompt,
    });
    ToolOutcome::ok(
        format!(
            "Forked into `{id}`, running as agent `{slot}` (model `{model_id}`) with a private copy \
             of this conversation. It starts once this turn's tool results are recorded, so collect \
             it with `wait_for_subagents` (or guide it with `send_message`) on a later turn, not \
             this one.",
            slot = label,
        ),
        format!("forked into `{id}`"),
        )
    // The structured half of the same facts, and the same sidecar `spawn_subagent` produces — so a
    // program's `fork()` reads the copy's handle back exactly as its `spawnSubagent` does, and the
    // console's existing spawn affordances light up with no new case.
    .with_data(ApiData::SubagentSpawned(SubagentHandleData {
        id,
        slot: label.to_string(),
        model_id,
    }))
}

/// What a copy is taken *from*: the forker's live window, that window's own
/// [module id](crate::modules::Module::instance_id), and the capability modules it holds.
///
/// The three travel together because they are one thing — everything the copy inherits — and they
/// are three references rather than a `&ModuleSet` because the loop does not always have a set to
/// point at: it holds the window and the capability modules split apart for the whole of a session
/// (the borrow checker will only prove those disjoint through the split), and on the
/// [responses-as-code](crate::sandbox) path the window has been moved out of its module altogether
/// for the duration of a program.
pub(super) struct ForkSource<'a> {
    /// The window the copy opens on.
    pub context: &'a ContextModel,
    /// That window's module id, which the copy's transition reports it was copied from.
    pub history_id: &'a str,
    /// The modules the copy links or copies, per kind.
    pub caps: &'a CapabilityModules,
    /// The forker's [program library](crate::programs), which the copy clones — entries and issued
    /// ids alike, so each keeps fetching the programs written before the fork and neither re-issues
    /// an id the other holds.
    pub programs: &'a ProgramLibrary,
}

/// Start every [fork](handle_fork) this turn declared, now that the turn's tool results are all
/// recorded and the window they are copying is a complete conversation again.
///
/// The copies are dispatched as ordinary children — same scheduler, same depth cap, same
/// [`ChildHandle`] the spawner waits on and messages through — differing only in that their modules
/// arrive [cloned](crate::modules::fork_modules) from the forker instead of resolved from a
/// profile, so they open on their forker's thread rather than on a brief.
///
/// A dispatch that fails here is logged rather than returned: the forker was told at the call that
/// the copy was made, and the two failure modes left by then (a model that stopped resolving
/// mid-turn, a scheduler that would not take the task) have no tool result to answer. Everything
/// that *can* be refused was refused at the call, which is why this is a warning rather than a
/// routine outcome.
pub(super) fn dispatch_forks(
    sub: &mut SubagentContext,
    spawner: &Agent,
    source: ForkSource<'_>,
    emitter: &Emitter,
    forks: Vec<PendingFork>,
    turns_taken: usize,
) {
    // A fork runs its forker's own profile, so it is named the same way the forker is.
    let label = sub.orch.caps.agent_name(&spawner.profile_id).to_string();
    for fork in forks {
        let (modules, cloned) =
            crate::modules::fork_modules(source.context, source.history_id, source.caps, &fork.id);
        let seed = Succession {
            note: fork_note(spawner, &label, &fork.prompt, turns_taken),
            modules,
            // A copy is the forker's whole conversation, always: that is what distinguishes it
            // from an ordinary subagent spawned on the same profile.
            history: true,
            // A copy is not standing anywhere in a machine: it is a second worker for the agent
            // that made it, not a second driver of the process that agent is in.
            from_state: None,
            // The copy continues its forker's turn numbering, because it is holding the very turns
            // that numbering refers to.
            turn_base: turns_taken,
            programs: source.programs.clone(),
        };
        let spec = ChildSpec::new(spawner.profile_id.clone(), fork.prompt.clone())
            .forked(fork.id.clone(), seed);
        match dispatch_child(sub, spawner, spec) {
            Ok(child) => emitter.emit(GgTelemetryKind::AgentTransition {
                kind: GgAgentTransitionKind::Fork,
                to_agent_id: child.id,
                profile_id: spawner.profile_id.clone(),
                // A fork is not a machine move, so there is no state to report.
                state: None,
                // Everything a fork carries, it carries: nothing is dropped, and nothing has to be
                // started empty, because the copy runs the very profile the original does. What is
                // worth reading here is *how* each module travelled — the copy's own task list
                // against the one board it shares with its forker.
                modules: cloned,
            }),
            Err(err) => emitter.emit(log(
                "warn",
                format!(
                    "the copy `{}` this agent forked could not be started ({err}); the agent has \
                     already been told it exists, so it may wait for a child that never runs.",
                    fork.id
                ),
            )),
        }
    }
}

/// Resolve and validate the target agent of a succession call against `roster`, returning the
/// profile id or the model-facing refusal that names the agents this one may reach.
// The `Err` is a `ToolOutcome` — the model-facing refusal — which is deliberately the same large
// enum every tool returns; boxing it here alone would just add an unwrap at each call site.
#[allow(clippy::result_large_err)]
pub(super) fn resolve_roster_target(
    roster: &[GgRosterEntry],
    args: &Value,
) -> Result<String, ToolOutcome> {
    let allowed = || {
        let ids: Vec<String> = roster
            .iter()
            .map(|entry| format!("`{}`", entry.agent_id))
            .collect();
        if ids.is_empty() {
            "none".to_string()
        } else {
            ids.join(", ")
        }
    };
    match args
        .get("agent")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|agent| !agent.is_empty())
    {
        Some(agent) if GgRosterEntry::offers(roster, agent) => Ok(agent.to_string()),
        Some(agent) => Err(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "`agent`: unknown agent `{agent}`; expected one of: {}",
                allowed()
            ),
        )),
        None => Err(ToolOutcome::failed(
            ToolFailure::InvalidArgument,
            format!(
                "missing required argument `agent`; expected one of: {}",
                allowed()
            ),
        )),
    }
}

/// The optional free-text message a succession call carries for the instance it creates, trimmed
/// and normalized to `None` when it is blank.
fn succession_message(call: &ToolCall, key: &str) -> Option<String> {
    call.arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string)
}

// ---------------------------------------------------------------------------
// What a carried window may still claim to describe
// ---------------------------------------------------------------------------

/// **Drop every [documentation view](GgContextSource::DocsView) this instance cannot render**, from
/// a window it inherited rather than opened.
///
/// A carried window is a *copy*: a [fork](handle_fork) clones its forker's whole conversation and a
/// history-keeping succession hands the successor the thread it was holding, and in both cases the
/// documentation band comes across verbatim. The band is a description of the surface the agent is
/// working through — and the arriving instance's surface is not its predecessor's. Two things it
/// held may be gone. Its [loaded code modules](crate::docs::LoadedDocs) certainly are: code is not a
/// [module](crate::modules), nothing transfers it, and a new instance starts with nothing loaded, so
/// a page headed `Documentation: csvTools.parse` describes a call this agent cannot write until it
/// uses the skill itself — which is the one call that brings both the module and its pages back. Its
/// gg functions may be too, since an `exec` succession resolves the successor's grants from another
/// profile.
///
/// Re-derivation is the test, and it is the same one both other boundaries use
/// ([`crate::persistence::restore_docviews`],
/// [`crate::compaction::restore_docviews`]): a key the arriving
/// instance's runtime renders is a key it may keep, and a key that renders nothing is dropped. One
/// rule for the three moments a window outlives the instance that filled it, rather than a fourth
/// spelling of it here.
///
/// It does not disturb the append-only rule the band otherwise keeps. That rule is about *a
/// session* — nothing inside one may take a page away from a model except the
/// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE) call it makes itself — and
/// this runs once, before the arriving instance has taken a turn, on a window it has not yet read.
///
/// Returns how many went, for the operator: a copy that quietly lost half its manual is worth a line
/// in the log, and a copy that lost none costs nothing to say nothing about.
pub(super) fn drop_unrenderable_docviews(context: &mut ContextModel, docs: &DocsRuntime) -> usize {
    let stale: Vec<String> = context
        .open_docviews()
        .into_iter()
        .filter(|open| docs.read_any(&open.key).is_none())
        .map(|open| open.key)
        .collect();
    for key in &stale {
        context.close_docviews(Some(key));
    }
    stale.len()
}

// ---------------------------------------------------------------------------
// The notes an arriving instance opens on
// ---------------------------------------------------------------------------

/// The note a successor opens on: who it is now, what it received, what it did not, and whatever its
/// predecessor wanted it to know.
///
/// It exists because the alternative is a model inferring its inheritance from absences. An agent
/// handed a thread but no task list would otherwise discover that by calling `add_task` and finding
/// the list empty — a discovery that costs a turn and looks, from inside the conversation, exactly
/// like a bug. Saying it outright costs a few dozen tokens once.
///
/// `fsm` is the position the successor actually occupies, which is not always the one the handoff
/// named: an `exec` that targets an [FSM shell](crate::fsm::is_shell) enters that machine, and the
/// note has to say so or the successor is left wondering where its transition call came from.
pub(super) fn succession_note(
    handoff: &Handoff,
    report: &TransferReport,
    profile: &GgAgentConfig,
    fsm: Option<&FsmPosition>,
) -> String {
    // Every profile the note names, it names by id — that is the vocabulary the successor would
    // use in a later `exec` — with the display name beside it so the sentence reads as prose.
    let successor = format!("`{}` ({})", profile.slug, profile.name);
    let mut note = match (&handoff.reason, fsm) {
        (HandoffReason::Fsm { from }, position) => format!(
            "This process has moved from `{from}` to `{}`. You are now running as the {successor} \
             agent, continuing the same session.",
            position.map(FsmPosition::state).unwrap_or(&profile.slug),
        ),
        (HandoffReason::Exec { from }, Some(position)) => format!(
            "The `{from}` agent has handed this session to the `{}` process, which starts in its \
             `{}` state. You are now running as the {successor} agent, continuing the same session.",
            position.fsm(),
            position.state(),
        ),
        (HandoffReason::Exec { from }, None) => format!(
            "The `{from}` agent has continued this session as you. You are now running as the \
             {successor} agent — its conversation above is yours."
        ),
    };
    let carried = describe_kinds(&report.carried());
    let dropped = describe_kinds(&report.dropped());
    let fresh = describe_kinds(&report.initialized());
    note.push_str(&match (carried, dropped.or(fresh)) {
        (Some(carried), Some(other)) => format!(" You carry over {carried}; {other} did not."),
        (Some(carried), None) => format!(" You carry over {carried}."),
        (None, Some(other)) => format!(" Nothing was carried over: {other} did not."),
        (None, None) => String::new(),
    });
    for reason in &report.notes {
        note.push(' ');
        note.push_str(reason);
    }
    if let Some(message) = &handoff.message {
        note.push_str("\n\n");
        note.push_str(message);
    }
    note
}

/// The note a [fork](handle_fork) opens on: where the conversation above it came from, that its
/// original is still running one of its own, and what this copy is for.
///
/// It names the turn because that is the number every item in the inherited window is stamped with:
/// a copy that later archives "turns 1–20" is naming the same twenty turns its forker would.
pub(super) fn fork_note(forker: &Agent, label: &str, prompt: &str, turn: usize) -> String {
    format!(
        "You were forked from agent `{id}` (the `{slot}` agent) at turn {turn}. Everything above is \
         that agent's conversation up to the moment it forked you — it is yours now, and it is \
         still running its own copy of it in parallel with you, so do not assume anything you do \
         here is visible to it. Your instructions from here:\n\n{prompt}",
        id = forker.id,
        slot = label,
    )
}

/// A list of [module kinds](ModuleKind) as a noun phrase — `the conversation, the task list and the
/// memories` — or `None` when there are none.
fn describe_kinds(kinds: &[ModuleKind]) -> Option<String> {
    let described: Vec<&str> = kinds
        .iter()
        .map(|kind| match kind {
            ModuleKind::History => "the conversation",
            ModuleKind::Memories => "the memories",
            ModuleKind::Tasks => "the task list",
            ModuleKind::Board => "the board",
            ModuleKind::Skills => "the skills already read",
            ModuleKind::Archive => "the thread archive",
        })
        .collect();
    match described.split_last() {
        None => None,
        Some((last, [])) => Some((*last).to_string()),
        Some((last, rest)) => Some(format!("{} and {last}", rest.join(", "))),
    }
}

// ---------------------------------------------------------------------------
// Launch diagnostics
// ---------------------------------------------------------------------------

/// The [exec](CAPABILITY_EXEC) and [fork](CAPABILITY_FORK) contribution to the
/// [launch pass](crate::validate::validate_launch): the configurations that switch one of them on
/// and would get **less of it than they asked for**.
///
/// Every one of these is a **refusal**, and this trio is the clearest case in gg for why. Each of
/// them resolves to *a tool that is not offered*, and an absent tool is the one misconfiguration a
/// model can never report: it simply never makes the call, and the run reads exactly like one where
/// the agent had the call and chose not to use it. A study comparing "with `exec`" against "without"
/// would be comparing two arms of the same thing, with nothing in either record to say so.
///
/// Nothing here is decided from anything but the document: a roster, a switch, and the state tables
/// of the machines the set declares. Each defect names the capability that would come up short, so
/// an agent that enables only `fork` is never told about a roster it has no use for.
pub(crate) fn check_launch(set: &GgCapabilitySet, report: &mut crate::validate::LaunchReport) {
    // Every profile a declared machine runs as one of its states. Such a profile keeps `fork` but is
    // never offered `exec`. Read off the machines that parse: one that does not is already refused
    // by [`crate::fsm::check_launch`], and its state list is not a thing to draw conclusions from.
    let state_agents: BTreeSet<String> = crate::fsm::machines(set)
        .into_iter()
        .flatten()
        .flat_map(|(_, spec)| {
            spec.states
                .values()
                .map(|state| state.agent_id.clone())
                .collect::<Vec<_>>()
        })
        .collect();
    for profile in &set.agents {
        let exec = profile.is_enabled(CAPABILITY_EXEC);
        let fork = profile.is_enabled(CAPABILITY_FORK);
        if !exec && !fork {
            continue;
        }
        if crate::fsm::is_shell(profile) {
            // A shell has no turns of its own; `fsm::check_launch` already refuses every capability
            // it declares, one by one, and repeating each here would name one defect twice.
            continue;
        }
        let locus = |capability: &str| format!("capabilities.{capability}");
        if exec
            && profile
                .agents_in_scope(GgSubagentScope::Subagent)
                .is_empty()
        {
            report.report(crate::validate::LaunchDefect::on_agent(
                &profile.slug,
                "subagents",
                "",
                format!(
                    "the `{}` ({}) agent enables `{CAPABILITY_EXEC}` but lists no agents it may \
                     use, so there is nothing for `{EXEC_TOOL}` to become and the call is not \
                     offered. Add the agents it may continue as to its roster, or switch \
                     `{CAPABILITY_EXEC}` off.",
                    profile.slug, profile.name,
                ),
            ));
        }
        if fork && !profile.is_enabled(CAPABILITY_SUBAGENTS) {
            report.report(crate::validate::LaunchDefect::on_agent(
                &profile.slug,
                locus(CAPABILITY_FORK),
                "",
                format!(
                    "the `{}` ({}) agent enables `{CAPABILITY_FORK}` but not \
                     `{CAPABILITY_SUBAGENTS}`, which is what offers `wait_for_subagents` and \
                     `send_message` — so a copy of it could never be waited on or messaged, and \
                     `{FORK_TOOL}` is not offered. Enable `{CAPABILITY_SUBAGENTS}`, or switch \
                     `{CAPABILITY_FORK}` off.",
                    profile.slug, profile.name,
                ),
            ));
        }
        if exec && state_agents.contains(profile.slug.trim()) {
            report.report(crate::validate::LaunchDefect::on_agent(
                &profile.slug,
                locus(CAPABILITY_EXEC),
                "",
                format!(
                    "the `{}` ({}) agent enables `{CAPABILITY_EXEC}` and is run as the state of a \
                     machine, so it is not offered `{EXEC_TOOL}` — inside a machine the next move \
                     is `{TRANSITION_STATE_TOOL}`'s. Switch `{CAPABILITY_EXEC}` off on it, or run \
                     it outside the machine. `{FORK_TOOL}` is unaffected.",
                    profile.slug, profile.name,
                ),
            ));
        }
    }
}
