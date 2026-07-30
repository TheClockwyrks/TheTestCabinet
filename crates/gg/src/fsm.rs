//! The gg **FSM capability** — currently inert, and the landing place for its replacement.
//!
//! An [FSM-driven process](https://docs.testcabinet.ai/gg/fsms/) makes the *order* of the work a
//! property of the process rather than of the model's discretion: the run is driven through a state
//! table, and each state binds an [agent profile](test_cabinet_core::gg::GgAgentConfig) that holds
//! the agent until it transitions on. Unlike a [workflow](crate::agent) — a fan-out the agent
//! assembles at will — the table is *configuration*, so which machine (if any) drives a run is part
//! of the [capability set](test_cabinet_core::gg::CAPABILITY_FSM).
//!
//! # Why this module is a stub
//!
//! gg's first FSM engine shipped a small library of **harness-authored** machines — `tdd`
//! (`write_tests → implement → verify`, order enforced by filesystem evidence guards) and
//! `plan-first` (a read-only planning pass → a fresh-context implementation pass) — selected by a
//! `machine` param naming one of them. Both have been removed, along with the `planning` capability
//! whose read-only mode and context reset `plan-first` reused: a machine that only gg can author is
//! a machine only gg can study, and the pair of built-ins was a fixed answer to a question a
//! configuration should be able to ask for itself.
//!
//! Their replacement is a **user-authored** state table over the run's other agent profiles, with
//! transitions naming the [modules](crate::modules) the successor inherits. It is not implemented
//! yet, so an enabled `fsm` capability drives nothing today. That is reported as a launch
//! [warning](launch_warnings) rather than passed over in silence: a configuration that still asks
//! for `tdd` would otherwise run as an ordinary single agent under the name of a machine, and every
//! number a comparison drew from it would be a measurement of the wrong thing.
//!
//! # What the replacement will need from here
//!
//! The module abstraction the transition rests on — [`transfer`](crate::modules::transfer),
//! [`TransferPlan`](crate::modules::TransferPlan) and the per-kind clone/adopt semantics — already
//! exists, as does the [`GgModuleKind`](test_cabinet_core::gg::GgModuleKind) vocabulary a transfer
//! list is written in. What lands here is the state table itself (parsing, validation, and the
//! position an agent instance occupies within it).

use test_cabinet_core::gg::{CAPABILITY_FSM, GgCapabilitySet};

/// The launch warnings a capability set's [FSM](CAPABILITY_FSM) configuration produces: one per
/// agent profile that enables the capability, because gg drives no state machine at present.
///
/// This is a **warning** and not a launch failure on the same terms as every other unrecognized
/// *value* in a capability set: a study whose configuration is ahead of the harness still runs, and
/// what it actually ran is stated on the root agent's stream before the first turn. It becomes a
/// hard failure — a set that asks for a machine gets one or is refused — once the replacement
/// engine can build a machine to check the request against.
///
/// Collected by [`Orchestrator::build`](crate::agent) alongside the rest of the launch diagnostics,
/// which is what puts it on the root agent's stream rather than in gg's own log.
pub fn launch_warnings(set: &GgCapabilitySet) -> Vec<String> {
    set.agents
        .iter()
        .filter(|agent| agent.is_enabled(CAPABILITY_FSM))
        .map(|agent| {
            format!(
                "agent `{}`: the `{CAPABILITY_FSM}` capability is enabled, but gg drives no state \
                 machine — the built-in `tdd` and `plan-first` machines were removed and the \
                 user-defined replacement is not implemented yet. This agent runs as an ordinary \
                 agent.",
                agent.name
            )
        })
        .collect()
}

#[cfg(test)]
#[path = "fsm.test.rs"]
mod tests;
