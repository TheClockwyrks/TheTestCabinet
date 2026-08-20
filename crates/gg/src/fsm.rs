//! gg's **FSM agents**: a user-authored state machine over the run's other agent profiles.
//!
//! An [FSM-driven process](https://docs.testcabinet.ai/gg/fsms/) makes the *order* of the work a
//! property of the process rather than of the model's discretion. Where a
//! [workflow](crate::agent) is a fan-out the agent assembles at will, a machine is a table the
//! agent is **driven through**: each [state](FsmStateSpec) binds an
//! [agent profile](GgAgentConfig), and a [transition](FsmTransitionSpec) tears the running instance
//! down and stands the next state's up, carrying exactly the [modules](crate::modules) the edge
//! names.
//!
//! # The shape of a machine
//!
//! A profile that enables the [`fsm`](CAPABILITY_FSM) capability is an **FSM shell**. It has no
//! turns of its own — so it carries **no model**, no prompt, no roster and no other capabilities —
//! and its whole content is the [`states`](FSM_PARAM_STATES) param: an ordered list of states, of
//! which the first is the entry, each naming the profile it runs and where it may go from there. A
//! state with no outgoing edges is terminal, and the machine ends when the agent in it ends.
//!
//! Because a shell runs no model, a dispatch onto one resolves its client through
//! [`GgCapabilitySet::dispatched_agent`] — the entry state's agent — rather than through the shell.
//! A machine is therefore namable everywhere an ordinary profile is without ever being given a
//! model binding that nothing would read. That resolution reads the entry state off the raw
//! capability set rather than off a parsed [`FsmSpec`], so the profile a dispatch binds and the
//! profile the backend names as the run's model cannot come apart; one hop is enough, because
//! [`check_launch`] refuses a machine whose state runs another shell.
//!
//! ```jsonc
//! { "id": "fsm", "enabled": true, "params": { "states": [
//!   { "name": "explore", "agentId": "explorer",
//!     "transitions": [{ "to": "build", "transfer": ["history", "tasks"],
//!                       "description": "when you have a task list" }] },
//!   { "name": "build", "agentId": "builder",
//!     "transitions": [{ "to": "verify", "transfer": ["history", "tasks"] }] },
//!   { "name": "verify", "agentId": "verifier" }
//! ] } }
//! ```
//!
//! # Why the built-in machines are gone
//!
//! gg's first FSM engine shipped a small library of **harness-authored** machines — `tdd` and
//! `plan-first` — selected by a `machine` param naming one of them. A machine only gg can author is
//! a machine only gg can study, and the pair was a fixed answer to a question a configuration
//! should be able to ask for itself. Both were removed, along with the `planning` capability whose
//! read-only pass `plan-first` reused. A set that still carries the old param and no `states` does
//! **not** silently run as an ordinary single agent: it fails to launch, because a run recorded as
//! "the TDD arm" that was nothing of the sort would poison every comparison drawn from it.
//!
//! # Every machine defect is a launch failure
//!
//! [`check_launch`] refuses a machine whose states are missing, unnamed, duplicated, or point at
//! things that do not exist — including a `transfer` entry naming something that is not a module
//! kind gg knows, which the contract type itself refuses before the machine is ever built. These
//! are structural in exactly the way an undeclared roster reference already is: a run with them is
//! not a differently-configured run, it is a run that would do something other than what it says.
//!
//! It refuses the two that used to be *warnings* on the same terms, because both describe a process
//! other than the one written down:
//!
//!  * **A declaration on an FSM shell that gg will never read** — a model binding, a prompt, a
//!    roster, a capability. The shell takes no turns, so every one of them is discarded; an operator
//!    who wrote one believes the machine's agents inherit it.
//!  * **A state unreachable from the entry state.** Every value in it is honoured, and the machine
//!    still runs a strictly smaller process than the one declared — with nothing in the run's record
//!    afterwards to show which states never ran because they *could* not.
//!
//! Nothing about a machine is a launch warning: there is no configuration here gg honours exactly as
//! written and still has something to say about.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use serde_json::Value;
use test_cabinet_core::gg::{
    CAPABILITY_FSM, FSM_PARAM_STATES, GgAgentConfig, GgCapabilitySet, GgFsmState, GgFsmTransition,
};

use crate::modules::ModuleKind;

/// One state of a resolved machine: the [agent profile](GgAgentConfig) that runs while the machine
/// sits here, and the edges leading out of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsmStateSpec {
    /// The state's name, as a [transition](FsmTransitionSpec::to) addresses it.
    pub name: String,
    /// The [id](GgAgentConfig::id) of the agent profile this state runs.
    pub agent_id: String,
    /// Where the agent in this state may go. Empty makes the state **terminal**: its agent is
    /// offered no transition call at all, so the machine ends when that agent does.
    pub transitions: Vec<FsmTransitionSpec>,
}

/// One edge of a resolved machine: where it leads, and what the successor takes with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FsmTransitionSpec {
    /// The [state](FsmStateSpec::name) this edge leads to.
    pub to: String,
    /// The [modules](ModuleKind) the successor's instance inherits, in the state they were in.
    /// Empty carries nothing, which is a deliberate hard reset — see [`GgFsmTransition::transfer`].
    pub transfer: Vec<ModuleKind>,
    /// When to take this edge, in the machine author's words. Rendered into the transition tool's
    /// description beside the target name.
    pub description: String,
}

/// A resolved machine: its shell profile's id, its entry state, and its state table.
///
/// Built once per shell profile at [launch](FsmSpec::resolve) and shared by every incarnation the
/// machine runs, so the table a transition is checked against is the same object the entry state was
/// read from — a machine cannot be re-parsed differently mid-run.
#[derive(Debug, PartialEq, Eq)]
pub struct FsmSpec {
    /// The [id](GgAgentConfig::id) of the **FSM shell** profile this machine was declared on. It
    /// is how the machine is addressed everywhere: in the transition telemetry, in the launch
    /// diagnostics, and in whatever spawned the FSM agent.
    pub fsm: String,
    /// The [state](FsmStateSpec::name) the machine starts in — `states[0]`.
    pub entry: String,
    /// The state table, keyed by name. A `BTreeMap` rather than the declared `Vec` because every
    /// question asked of it after parsing is "what is the state called `x`?", and the declaration
    /// order is already captured by [`entry`](Self::entry).
    pub states: BTreeMap<String, FsmStateSpec>,
}

impl FsmSpec {
    /// Read the machine `profile` declares, or `None` when it declares none — the capability is
    /// absent or off (the overwhelmingly common case), or it is on and writes no
    /// [`states`](FSM_PARAM_STATES).
    ///
    /// That last absence is **not** reported here. `states` is the machine's whole content, so it is
    /// [required](crate::validate::Requirement::Required) of every enabled declaration and refused
    /// at its own locus by the pass that can see the switch; saying it a second time in this
    /// module's words would name one hole as two.
    ///
    /// Returns `Err` for a machine gg cannot build at all: an unparseable or empty `states` param,
    /// an unnamed or duplicated state. The *cross-profile* checks — that every named agent exists
    /// and is not itself a shell — need the whole set and live in [`check_launch`].
    pub fn resolve(profile: &GgAgentConfig) -> Option<Result<Self, String>> {
        let capability = profile
            .capability(CAPABILITY_FSM)
            .filter(|capability| capability.enabled)?;
        let states = capability.params.get(FSM_PARAM_STATES)?;
        Some(Self::parse(&profile.slug, states))
    }

    /// Build the machine the shell profile with id `fsm` declares, from the raw
    /// [`states`](FSM_PARAM_STATES) param value.
    ///
    /// Split out from [`resolve`](Self::resolve) so the parse — the half with all the diagnostics —
    /// is unit-testable against a bare JSON value rather than through a whole capability set.
    fn parse(fsm: &str, states: &Value) -> Result<Self, String> {
        let declared: Vec<GgFsmState> = serde_json::from_value(states.clone()).map_err(|err| {
            format!(
                "the `{fsm}` agent's `{CAPABILITY_FSM}` capability declares a `{FSM_PARAM_STATES}` \
                 gg could not read ({err}); it must be a list of \
                 `{{ name, agentId, transitions: [{{ to, transfer, description }}] }}` objects."
            )
        })?;
        if declared.is_empty() {
            return Err(format!(
                "the `{fsm}` agent's `{CAPABILITY_FSM}` capability declares an empty \
                 `{FSM_PARAM_STATES}`; a machine with no states has nothing to enter."
            ));
        }

        let mut states = BTreeMap::new();
        let mut entry = None;
        for state in declared {
            let name = state.name.trim().to_string();
            if name.is_empty() {
                return Err(format!(
                    "the `{fsm}` agent's machine has a state with an empty name; a transition \
                     addresses a state by name, so every state needs one."
                ));
            }
            if states.contains_key(&name) {
                return Err(format!(
                    "the `{fsm}` agent's machine declares the state `{name}` more than once; a \
                     transition to it would have no single answer."
                ));
            }
            entry.get_or_insert_with(|| name.clone());
            states.insert(
                name.clone(),
                FsmStateSpec {
                    name,
                    agent_id: state.agent_id.trim().to_string(),
                    transitions: state.transitions.into_iter().map(transition_spec).collect(),
                },
            );
        }
        Ok(Self {
            fsm: fsm.to_string(),
            // Every branch above either returns or inserts, and the list is non-empty, so the
            // entry was set on the first iteration.
            entry: entry.expect("a non-empty state list names an entry state"),
            states,
        })
    }

    /// The state named `name`, or `None` when the machine declares no such state.
    pub fn state(&self, name: &str) -> Option<&FsmStateSpec> {
        self.states.get(name)
    }

    /// The [position](FsmPosition) an agent entering this machine's entry state occupies.
    pub fn entry_position(self: &Arc<Self>) -> FsmPosition {
        FsmPosition {
            spec: Arc::clone(self),
            state: self.entry.clone(),
        }
    }

    /// Every state name reachable from the [entry](Self::entry) by following transitions, including
    /// the entry itself. What [`check_launch`] measures a declared-but-orphaned state against.
    fn reachable(&self) -> BTreeSet<&str> {
        let mut seen = BTreeSet::new();
        let mut frontier = vec![self.entry.as_str()];
        while let Some(name) = frontier.pop() {
            let Some(state) = self.states.get(name) else {
                continue;
            };
            if !seen.insert(state.name.as_str()) {
                continue;
            }
            frontier.extend(
                state
                    .transitions
                    .iter()
                    .map(|transition| transition.to.as_str()),
            );
        }
        seen
    }
}

/// Lower one declared edge.
///
/// Every entry of the transfer list is already a [module kind](ModuleKind) gg knows — the document
/// would not have parsed otherwise, and a machine that transferred less than it says it does is a
/// launch failure rather than a lowering concern. All this does is deduplicate, in declaration
/// order, so a transfer list that names `history` twice carries it once and the diagnostics do not
/// repeat themselves.
fn transition_spec(transition: GgFsmTransition) -> FsmTransitionSpec {
    let mut transfer: Vec<ModuleKind> = Vec::with_capacity(transition.transfer.len());
    for kind in transition.transfer {
        if !transfer.contains(&kind) {
            transfer.push(kind);
        }
    }
    FsmTransitionSpec {
        to: transition.to.trim().to_string(),
        transfer,
        description: transition.description.trim().to_string(),
    }
}

/// Where one agent instance sits in a machine: which machine, and which of its states.
///
/// Carried on the [`Agent`](crate::agent) itself rather than looked up, because the two things it
/// answers are asked at very different moments — *"which transitions may this agent's toolset
/// offer?"* when the instance is built, and *"is `verify` a legal target from here?"* mid-turn, on
/// the sandbox's blocking thread — and both need the same table.
#[derive(Clone)]
pub struct FsmPosition {
    /// The machine being driven, shared with every other incarnation of this FSM agent.
    spec: Arc<FsmSpec>,
    /// The [state](FsmStateSpec::name) this instance is running. Always a key of
    /// [`spec.states`](FsmSpec::states): every position is built either from the machine's entry or
    /// from a transition that was checked against the table.
    state: String,
}

impl FsmPosition {
    /// The machine's id — the FSM shell profile it was declared on.
    pub fn fsm(&self) -> &str {
        &self.spec.fsm
    }

    /// The state this instance is running.
    pub fn state(&self) -> &str {
        &self.state
    }

    /// The state's own specification. Infallible by construction — see [`state`](Self::state).
    pub fn current(&self) -> &FsmStateSpec {
        self.spec
            .state(&self.state)
            .expect("a position always names a declared state")
    }

    /// The [id](GgAgentConfig::id) of the [agent profile](GgAgentConfig) this state runs.
    pub fn agent_id(&self) -> &str {
        &self.current().agent_id
    }

    /// The edges leading out of this state. Empty in a terminal state.
    pub fn outgoing(&self) -> &[FsmTransitionSpec] {
        &self.current().transitions
    }

    /// The edge to `target`, or the model-facing refusal that names every legal target.
    ///
    /// A refusal rather than a launch check because this is the model's mistake, not the
    /// configuration's: the agent stays where it is, is told what it may actually name, and the run
    /// continues. Naming the alternatives is the whole of the recovery.
    pub fn transition_to(&self, target: &str) -> Result<&FsmTransitionSpec, String> {
        let target = target.trim();
        if let Some(transition) = self
            .outgoing()
            .iter()
            .find(|transition| transition.to == target)
        {
            return Ok(transition);
        }
        if self.outgoing().is_empty() {
            return Err(format!(
                "`{}` is a terminal state of the `{}` machine: there is nowhere to transition to \
                 from here. End your session instead.",
                self.state, self.spec.fsm,
            ));
        }
        Err(format!(
            "`{target}` is not a state you may transition to from `{}`. The states you may move to: \
             {}.",
            self.state,
            self.legal_targets(),
        ))
    }

    /// The position this instance's successor occupies after taking `transition`.
    pub fn moved_to(&self, transition: &FsmTransitionSpec) -> Self {
        Self {
            spec: Arc::clone(&self.spec),
            state: transition.to.clone(),
        }
    }

    /// The outgoing targets as a sentence, each with its author's guidance — what the transition
    /// tool's description enumerates and what a refusal lists back.
    ///
    /// Deliberately the same shape as the delegation tools' agent menu: naming a state to move to
    /// and naming an agent to spawn are the same act from the model's side, so they read the same
    /// way.
    pub fn legal_targets(&self) -> String {
        if self.outgoing().is_empty() {
            return "(none — this is a terminal state)".to_string();
        }
        self.outgoing()
            .iter()
            .map(|transition| {
                if transition.description.is_empty() {
                    format!("`{}`", transition.to)
                } else {
                    format!("`{}` ({})", transition.to, transition.description)
                }
            })
            .collect::<Vec<_>>()
            .join("; ")
    }
}

/// Every machine `set` declares, keyed by the FSM shell profile that declares it — built once at
/// launch and shared by every agent instance the machines run.
///
/// Returns the first structural error rather than a partial table: a set with an unbuildable
/// machine in it is unrunnable, and [`check_launch`] has already refused it by the time this is called
/// in production. It is fallible here too because the two must not be able to disagree.
pub fn machines(set: &GgCapabilitySet) -> Result<BTreeMap<String, Arc<FsmSpec>>, String> {
    let mut machines = BTreeMap::new();
    for profile in &set.agents {
        let Some(spec) = FsmSpec::resolve(profile) else {
            continue;
        };
        machines.insert(profile.slug.trim().to_string(), Arc::new(spec?));
    }
    Ok(machines)
}

/// Whether `profile` is an **FSM shell** — a profile whose whole content is a machine, with no
/// turns of its own.
pub fn is_shell(profile: &GgAgentConfig) -> bool {
    profile.is_fsm_shell()
}

/// The [FSM](CAPABILITY_FSM) contribution to the [launch pass](crate::validate::validate_launch):
/// every machine `set` declares, read exactly as the run will read it, with every defect reported
/// rather than the first.
///
/// What is refused, all of it in the same class as a roster reference naming an undeclared profile —
/// a run carrying one is not a differently-configured run, it is an unrunnable one, or one that
/// would do something other than what it says:
///
/// - an enabled `fsm` capability whose `states` is absent, unparseable, or empty;
/// - a state with an empty name, or two states with the same name (both from [`FsmSpec::parse`]);
/// - a state whose `agentId` names a profile the set does not declare;
/// - a transition whose `to` names a state the machine does not declare;
/// - an FSM shell named as a state's `agentId` — a shell cannot be a state, because entering it
///   would enter a second machine inside the first with no way to say which one a transition
///   addressed;
/// - anything else the shell declares, which nothing will read;
/// - a state unreachable from the entry state.
///
/// A machine that does not parse contributes only that: there is no table to ask the rest of the
/// questions of, and the parse error is the cause every other line would be a consequence of.
pub fn check_launch(set: &GgCapabilitySet, report: &mut crate::validate::LaunchReport) {
    for profile in &set.agents {
        let Some(resolved) = FsmSpec::resolve(profile) else {
            continue;
        };
        report.for_agent(&profile.slug, |report| match resolved {
            Err(err) => report.report(crate::validate::LaunchDefect::run_level(
                param_locus(FSM_PARAM_STATES),
                "",
                err,
            )),
            Ok(spec) => {
                check_shell_declarations(set, profile, report);
                check_states(set, &spec, report);
            }
        });
    }
}

/// Every state of one parsed machine: the profile it runs, where its edges lead, and whether
/// anything can reach it.
fn check_states(set: &GgCapabilitySet, spec: &FsmSpec, report: &mut crate::validate::LaunchReport) {
    let fsm = named(set, &spec.fsm);
    let reachable = spec.reachable();
    let locus = |state: &str| format!("{}[{state}]", param_locus(FSM_PARAM_STATES));
    for state in spec.states.values() {
        if state.agent_id.is_empty() {
            report.report(crate::validate::LaunchDefect::run_level(
                locus(&state.name),
                "",
                format!(
                    "the {fsm} machine's `{}` state names no agent; every state runs an agent \
                     profile.",
                    state.name
                ),
            ));
        } else if let Some(profile) = set.agent(&state.agent_id) {
            if is_shell(profile) {
                report.report(crate::validate::LaunchDefect::run_level(
                    locus(&state.name),
                    &state.agent_id,
                    format!(
                        "the {fsm} machine's `{}` state runs the {} agent, which is itself an FSM \
                         shell; a machine cannot be a state of another machine. Name one of its \
                         states' agents instead.",
                        state.name,
                        named(set, &state.agent_id)
                    ),
                ));
            }
        } else {
            report.report(
                crate::validate::LaunchDefect::run_level(
                    locus(&state.name),
                    &state.agent_id,
                    format!(
                        "the {fsm} machine's `{}` state runs the `{}` agent, which is not a \
                         declared agent profile.",
                        state.name, state.agent_id
                    ),
                )
                .known(set.agents.iter().map(|agent| agent.slug.as_str())),
            );
        }
        for transition in &state.transitions {
            if !spec.states.contains_key(&transition.to) {
                report.report(
                    crate::validate::LaunchDefect::run_level(
                        locus(&state.name),
                        &transition.to,
                        format!(
                            "the {fsm} machine's `{}` state may transition to `{}`, which is not a \
                             state it declares.",
                            state.name, transition.to
                        ),
                    )
                    .known(spec.states.keys().map(String::as_str)),
                );
            }
            check_transfer(set, spec, state, transition, report);
        }
        // A state nothing leads to is a state that will never run, and the machine is therefore a
        // strictly smaller process than the one written down — with nothing in the run's record
        // afterwards to distinguish "this state never came up" from "this state could not". It is
        // refused on the same footing as a transition whose target does not exist: both are edges
        // the author believed they had drawn.
        if !reachable.contains(state.name.as_str()) {
            report.report(crate::validate::LaunchDefect::run_level(
                locus(&state.name),
                &state.name,
                format!(
                    "the {fsm} machine's `{}` state is unreachable from the entry state `{}`, so \
                     nothing can ever enter it. Give it an incoming transition, or remove it.",
                    state.name, spec.entry,
                ),
            ));
        }
    }
}

/// **One edge's transfer list, read against the module set the outgoing state actually holds.**
///
/// A transfer names what the successor continues with. An entry naming a module the *source* state
/// does not hold cannot be honoured: the successor starts with an empty one under a configuration
/// that says it continues, and the one place that would show is a store that stayed empty. gg's own
/// transfer reports it and ends the run as an internal error, which is the right answer for a
/// pairing only the run could discover — and the wrong answer for this one, which is written down in
/// the machine's own table and decidable before a token is spent.
///
/// Decided against [`would_hold`](crate::modules::would_hold), the static form of the
/// [`has`](crate::modules::ModuleSet::has) the transfer itself asks — so the launch refuses exactly
/// the edges the run would have faulted on, and no others. The *receiving* side is not checked here:
/// a successor whose profile switches the capability off drops the module deliberately, which is a
/// documented disposition rather than a defect.
fn check_transfer(
    set: &GgCapabilitySet,
    spec: &FsmSpec,
    state: &FsmStateSpec,
    transition: &FsmTransitionSpec,
    report: &mut crate::validate::LaunchReport,
) {
    let Some(profile) = set.agent(&state.agent_id) else {
        // The state's agent is not a declared profile, which is already reported; there is no
        // configuration to read a module set off.
        return;
    };
    let fsm = named(set, &spec.fsm);
    for kind in &transition.transfer {
        if crate::modules::would_hold(set, profile, *kind) {
            continue;
        }
        report.report(crate::validate::LaunchDefect::run_level(
            format!(
                "{}[{}].transitions[{}].transfer",
                param_locus(FSM_PARAM_STATES),
                state.name,
                transition.to,
            ),
            kind.to_string(),
            format!(
                "the {fsm} machine's `{}` state transfers the `{kind}` module to `{}`, and the {} \
                 agent it runs holds no such module. The successor would open with an empty one \
                 under a configuration that says it continues.",
                state.name,
                transition.to,
                named(set, &state.agent_id),
            ),
        ));
    }
}

/// Everything an [FSM shell](is_shell) profile declares that gg will never read — refused, one
/// defect per declaration, in the operator's own vocabulary.
///
/// Everything a *worker* profile is configured with is on this list, because a machine is not a
/// worker: it never takes a turn, so there is no model to call, no prompt to render, no roster to
/// spawn from, no capability whose tools anything would be offered, no gate to fire around a turn
/// and no reply for a detector to read. Each state runs the agent
/// profile it names, with **that** profile's configuration — so a declaration here is not a value gg
/// substitutes something else for, it is a value gg discards, and an operator who wrote one believes
/// the machine's agents inherit it. The console's editor offers a machine none of these fields, so
/// one reaching here comes from a hand-written set or an older editor.
fn check_shell_declarations(
    set: &GgCapabilitySet,
    profile: &GgAgentConfig,
    report: &mut crate::validate::LaunchReport,
) {
    let fsm = named(set, &profile.slug);
    let ignored = |locus: &str, what: &str| {
        crate::validate::LaunchDefect::run_level(
            locus,
            "",
            format!(
                "the {fsm} agent is an FSM shell, so the {what} it declares would never be read \
                 — each state runs the agent profile it names, with that profile's configuration. \
                 Remove it, or move it onto the profile a state runs."
            ),
        )
    };
    if profile.resolved_model_id().is_some() {
        report.report(ignored("model", "model binding"));
    }
    if profile.model_slot.is_some() {
        report.report(ignored("modelSlot", "model slot"));
    }
    if profile
        .custom_instructions
        .as_deref()
        .is_some_and(|prose| !prose.trim().is_empty())
        || profile.system_prompt_template.is_some()
    {
        report.report(ignored("systemPrompt", "system prompt"));
    }
    if !profile.subagents.is_empty() {
        report.report(ignored("subagents", "roster"));
    }
    // A hook fires around a turn — a write, a shell command, a compaction, an agent's own start and
    // stop — and the runtime that holds one is looked up by the profile actually running. A machine
    // takes no turn, so a `pre-write` gate declared here is a gate that always passes, which is
    // worse than no gate because an operator believes they have one.
    if !profile.hooks.is_empty() {
        report.report(ignored("hooks", "hooks"));
    }
    // The detector watches a reply arrive, and a machine produces none. An armed one here would
    // also demand its five knobs, so the machine would be asked for figures parameterising
    // machinery gg never builds.
    if !profile.loop_detection.is_default() {
        report.report(ignored("loopDetection", "loop detector"));
    }
    for (index, capability) in profile.capabilities.iter().enumerate() {
        if capability.enabled && capability.id != CAPABILITY_FSM {
            report.report(ignored(
                &format!("capabilities[{index}].id"),
                &format!("`{}` capability", capability.id),
            ));
        }
    }
}

/// How a diagnostic names one profile: the [id](GgAgentConfig::id) an operator would edit, with the
/// [display name](GgAgentConfig::name) beside it so a table of slugs still reads as prose.
///
/// Only for a profile `set` declares — a dangling reference is named by its bare id instead, since
/// [`GgCapabilitySet::agent_name`] answers an unknown id with the id itself, and `` `x` (x) `` says
/// nothing twice.
fn named(set: &GgCapabilitySet, id: &str) -> String {
    format!("`{id}` ({})", set.agent_name(id))
}

/// Where one of the machine's own params sits in the document: `fsm.params.states`.
fn param_locus(key: &str) -> String {
    crate::validate::param_locus(CAPABILITY_FSM, key)
}

#[cfg(test)]
#[path = "fsm.test.rs"]
mod tests;
