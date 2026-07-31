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
//! turns of its own — its model binding and its other capabilities are ignored — and its whole
//! content is the [`states`](FSM_PARAM_STATES) param: an ordered list of states, of which the first
//! is the entry, each naming the profile it runs and where it may go from there. A state with no
//! outgoing edges is terminal, and the machine ends when the agent in it ends.
//!
//! ```jsonc
//! { "id": "fsm", "enabled": true, "params": { "states": [
//!   { "name": "explore", "agent": "Explorer",
//!     "transitions": [{ "to": "build", "transfer": ["history", "tasks"],
//!                       "description": "when you have a task list" }] },
//!   { "name": "build", "agent": "Builder",
//!     "transitions": [{ "to": "verify", "transfer": ["history", "tasks"] }] },
//!   { "name": "verify", "agent": "Verifier" }
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
//! # Structural errors are launch failures
//!
//! [`validate`] refuses a machine whose states are missing, unnamed, duplicated, or point at things
//! that do not exist. These are structural in exactly the way an undeclared roster reference already
//! is — a run with them is not a differently-configured run, it is an unrunnable one — so they are
//! hard failures rather than the warn-and-fall-back gg applies to unrecognized *values*. The softer
//! problems (a transfer list naming a module kind gg does not know, a state nothing can reach) are
//! [warnings](launch_warnings): the machine still runs, and what it will actually do is stated
//! before the first turn.

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
    /// The agent profile this state runs.
    pub agent: String,
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

/// A resolved machine: its shell profile's name, its entry state, and its state table.
///
/// Built once per shell profile at [launch](FsmSpec::resolve) and shared by every incarnation the
/// machine runs, so the table a transition is checked against is the same object the entry state was
/// read from — a machine cannot be re-parsed differently mid-run.
#[derive(Debug, PartialEq, Eq)]
pub struct FsmSpec {
    /// The **FSM shell** profile this machine was declared on. It is the machine's name everywhere:
    /// in the transition telemetry, in the launch diagnostics, and in whatever spawned the FSM agent.
    pub fsm: String,
    /// The [state](FsmStateSpec::name) the machine starts in — `states[0]`.
    pub entry: String,
    /// The state table, keyed by name. A `BTreeMap` rather than the declared `Vec` because every
    /// question asked of it after parsing is "what is the state called `x`?", and the declaration
    /// order is already captured by [`entry`](Self::entry).
    pub states: BTreeMap<String, FsmStateSpec>,
}

impl FsmSpec {
    /// Read the machine `profile` declares, or `None` when it declares none (the capability is
    /// absent or off — the overwhelmingly common case).
    ///
    /// Returns `Err` for a machine gg cannot build at all: an unparseable or empty `states` param,
    /// an unnamed or duplicated state. The *cross-profile* checks — that every named agent exists
    /// and is not itself a shell — need the whole set and live in [`validate`].
    pub fn resolve(profile: &GgAgentConfig) -> Option<Result<Self, String>> {
        let capability = profile
            .capability(CAPABILITY_FSM)
            .filter(|capability| capability.enabled)?;
        Some(Self::parse(
            &profile.name,
            capability.params.get(FSM_PARAM_STATES),
        ))
    }

    /// Build a machine named `fsm` from the raw [`states`](FSM_PARAM_STATES) param value.
    ///
    /// Split out from [`resolve`](Self::resolve) so the parse — the half with all the diagnostics —
    /// is unit-testable against a bare JSON value rather than through a whole capability set.
    fn parse(fsm: &str, states: Option<&Value>) -> Result<Self, String> {
        let Some(states) = states else {
            return Err(format!(
                "the `{fsm}` agent enables the `{CAPABILITY_FSM}` capability but declares no \
                 `{FSM_PARAM_STATES}`; an FSM agent has no turns of its own, so there would be \
                 nothing to run. Declare the states it drives, entry state first."
            ));
        };
        let declared: Vec<GgFsmState> = serde_json::from_value(states.clone()).map_err(|err| {
            format!(
                "the `{fsm}` agent's `{CAPABILITY_FSM}` capability declares a `{FSM_PARAM_STATES}` \
                 gg could not read ({err}); it must be a list of \
                 `{{ name, agent, transitions: [{{ to, transfer, description }}] }}` objects."
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
                    agent: state.agent.trim().to_string(),
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
    /// the entry itself. What [`launch_warnings`] measures a declared-but-orphaned state against.
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

/// Lower one declared edge, dropping any [module kind](ModuleKind) gg does not know.
///
/// An unknown kind is dropped rather than refused because it is an unrecognized *value*, which gg
/// treats everywhere by falling back and saying so — [`launch_warnings`] names it. The list is
/// deduplicated in declaration order, so a transfer list that names `history` twice carries it once
/// and the diagnostics do not repeat themselves.
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
    /// The machine's name — the FSM shell profile it was declared on.
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

    /// The [agent profile](GgAgentConfig) this state runs.
    pub fn agent(&self) -> &str {
        &self.current().agent
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
/// machine in it is unrunnable, and [`validate`] has already refused it by the time this is called
/// in production. It is fallible here too because the two must not be able to disagree.
pub fn machines(set: &GgCapabilitySet) -> Result<BTreeMap<String, Arc<FsmSpec>>, String> {
    let mut machines = BTreeMap::new();
    for profile in &set.agents {
        let Some(spec) = FsmSpec::resolve(profile) else {
            continue;
        };
        machines.insert(profile.name.trim().to_string(), Arc::new(spec?));
    }
    Ok(machines)
}

/// Whether `profile` is an **FSM shell** — a profile whose whole content is a machine, with no
/// turns of its own.
pub fn is_shell(profile: &GgAgentConfig) -> bool {
    profile.is_enabled(CAPABILITY_FSM)
}

/// Validate every [machine](FsmSpec) `set` declares, returning the first structural problem.
///
/// The checks that are launch **failures**, in the same class as a roster reference naming an
/// undeclared profile:
///
/// - an enabled `fsm` capability whose `states` is absent, unparseable, or empty;
/// - a state with an empty name, or two states with the same name (both from [`FsmSpec::parse`]);
/// - a state whose `agent` names a profile the set does not declare;
/// - a transition whose `to` names a state the machine does not declare;
/// - an FSM shell named as a state's `agent` — a shell cannot be a state, because entering it would
///   enter a second machine inside the first with no way to say which one a transition addressed.
///
/// Called from `validate_agents` at launch, before any agent is built.
pub fn validate(set: &GgCapabilitySet) -> Result<(), String> {
    for (fsm, spec) in machines(set)? {
        for state in spec.states.values() {
            if state.agent.is_empty() {
                return Err(format!(
                    "the `{fsm}` machine's `{}` state names no agent; every state runs an agent \
                     profile.",
                    state.name
                ));
            }
            let Some(profile) = set.agent(&state.agent) else {
                return Err(format!(
                    "the `{fsm}` machine's `{}` state runs the `{}` agent, which is not a declared \
                     agent profile.",
                    state.name, state.agent
                ));
            };
            if is_shell(profile) {
                return Err(format!(
                    "the `{fsm}` machine's `{}` state runs the `{}` agent, which is itself an FSM \
                     shell; a machine cannot be a state of another machine. Name one of its states' \
                     agents instead.",
                    state.name, state.agent
                ));
            }
            for transition in &state.transitions {
                if !spec.states.contains_key(&transition.to) {
                    return Err(format!(
                        "the `{fsm}` machine's `{}` state may transition to `{}`, which is not a \
                         state it declares.",
                        state.name, transition.to
                    ));
                }
            }
        }
    }
    Ok(())
}

/// The launch **warnings** a capability set's [FSM](CAPABILITY_FSM) configuration produces: the
/// problems that leave the machine runnable but not quite the machine that was written down.
///
/// Reported rather than refused, on the same terms as every other unrecognized *value*: the run
/// still happens, and what it will actually do is stated on the root agent's stream before the
/// first turn.
///
/// Collected by [`Orchestrator::build`](crate::agent) alongside the rest of the launch diagnostics.
/// It assumes [`validate`] has already passed — an unbuildable machine contributes nothing here,
/// because there is nothing to warn *about* until there is a machine.
pub fn launch_warnings(set: &GgCapabilitySet) -> Vec<String> {
    let mut warnings = Vec::new();
    let Ok(machines) = machines(set) else {
        return warnings;
    };
    for (fsm, spec) in machines {
        // A shell has no turns of its own, so anything else it declares is configuration that will
        // never be read. Said out loud because the alternative is an operator who believes the
        // machine's agents inherited the shell's memories.
        if let Some(profile) = set.agent(&fsm) {
            let extra: Vec<&str> = profile
                .capabilities
                .iter()
                .filter(|capability| capability.enabled && capability.id != CAPABILITY_FSM)
                .map(|capability| capability.id.as_str())
                .collect();
            if !extra.is_empty() {
                warnings.push(format!(
                    "agent `{fsm}`: it is an FSM shell, so its own model binding and its other \
                     capabilities ({}) are ignored — each state runs the agent profile it names, \
                     with that profile's configuration.",
                    extra.join(", "),
                ));
            }
        }
        let reachable = spec.reachable();
        for state in spec.states.values() {
            if !reachable.contains(state.name.as_str()) {
                warnings.push(format!(
                    "agent `{fsm}`: the `{}` state is unreachable from the entry state `{}`; it is \
                     kept, but nothing can enter it.",
                    state.name, spec.entry,
                ));
            }
        }
    }
    warnings.extend(unknown_transfer_kinds(set));
    warnings
}

/// The warnings for a `transfer` entry naming something that is not a [module kind](ModuleKind).
///
/// This is the one diagnostic the parsed machine cannot produce: serde refuses the whole `states`
/// value for one bad kind, and refusing a machine because a transfer list has a typo in it would
/// turn a warn-and-fall-back into a launch failure. So the raw param is re-read here, leniently, and
/// the unknown names are reported while the machine itself parses from the kinds gg does know.
fn unknown_transfer_kinds(set: &GgCapabilitySet) -> Vec<String> {
    let mut warnings = Vec::new();
    let known: Vec<&str> = ModuleKind::ALL.iter().map(|kind| kind.as_str()).collect();
    for profile in &set.agents {
        let Some(states) = profile
            .capability(CAPABILITY_FSM)
            .filter(|capability| capability.enabled)
            .and_then(|capability| capability.params.get(FSM_PARAM_STATES))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for name in states
            .iter()
            .filter_map(|state| state.get("transitions")?.as_array())
            .flatten()
            .filter_map(|transition| transition.get("transfer")?.as_array())
            .flatten()
            .filter_map(Value::as_str)
            .filter(|name| !known.contains(name))
        {
            warnings.push(format!(
                "agent `{}`: a transition's `transfer` names `{name}`, which is not a module gg \
                 knows ({}); it carries nothing.",
                profile.name,
                known.join(", "),
            ));
        }
    }
    warnings
}

#[cfg(test)]
#[path = "fsm.test.rs"]
mod tests;
