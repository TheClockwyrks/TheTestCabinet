//! The membrane's delegation family: spawning child agents, waiting for them, and messaging them.
//!
//! These three are the reason the [api](super::ToolApi) behind this membrane is the loop's own
//! `LoopToolApi` and not a self-contained tool: a delegation call is serviced by the **subagent
//! scheduler**, which the api reaches (from the blocking sandbox thread) with a
//! [`Handle`](tokio::runtime::Handle)`::block_on`, with the agent tree and the parallelism cap it
//! owns. A program's `spawnSubagent` therefore behaves exactly as a native `spawn_subagent` does,
//! including its depth cap — the only difference is that a program can compose the results.
//!
//! One lowering lives here: a brief is a **variant**, so "neither a prompt nor an issue" — which
//! today's JSON schema allows and rejects only at run time, wasting a call — cannot be expressed at
//! all.
//!
//! # These sidecars are produced by the loop, not by a tool
//!
//! `spawn_subagent` and `wait_for_subagents` never reach a
//! [`Tool`](crate::tools::Tool) at all: the `LoopToolApi` recognises them and routes them to the
//! subagent scheduler, so the [`ToolData`] each of them reads back is attached **there**. Until that
//! routing attaches it, every one of these functions reports `missing_data` — and the tests below
//! pass regardless, because their `FakeToolApi` supplies the sidecar the real system has to. Read a
//! green suite here as "the conversion is right", never as "the producer exists".

use super::test_cabinet::gg::delegation::{
    AgentStatus, Host as DelegationHost, SpawnRequest, SubagentBrief, SubagentHandle,
    SubagentResult,
};
use super::test_cabinet::gg::types::ToolError;
use super::{MembraneState, ToolApi};
use crate::sandbox::operations::{
    DELEGATION_EXEC, DELEGATION_FORK, DELEGATION_SEND_MESSAGE, DELEGATION_SPAWN_SUBAGENT,
    DELEGATION_TRANSITION_STATE, DELEGATION_WAIT_FOR_SUBAGENTS,
};
use crate::tools::{AgentStatusData, SubagentHandleData, SubagentResultData, ToolData};

impl<A: ToolApi> DelegationHost for MembraneState<A> {
    fn spawn_subagent(&mut self, request: SpawnRequest) -> Result<SubagentHandle, ToolError> {
        self.recorded(DELEGATION_SPAWN_SUBAGENT, |state, rec| {
            let (prompt, issue_id) = brief(request.task);
            let agent = request.agent;
            let outcome = state.call(rec, DELEGATION_SPAWN_SUBAGENT, |api| {
                api.spawn_subagent(agent, prompt, issue_id)
            })?;
            // Every payload here is destructured field by field rather than read through dots, so a
            // field added to one fails to compile at the membrane — which is where someone has to
            // decide whether a program should be able to see it.
            match outcome.data {
                Some(ToolData::SubagentSpawned(SubagentHandleData { id, slot, model_id })) => {
                    Ok(SubagentHandle { id, slot, model_id })
                }
                other => Err(state.missing_data(DELEGATION_SPAWN_SUBAGENT, other.as_ref())),
            }
        })
    }

    fn wait_for_subagents(
        &mut self,
        ids: Option<Vec<String>>,
    ) -> Result<Vec<SubagentResult>, ToolError> {
        // This blocks while the children run, and the run's wall-clock budget keeps running with
        // it. The deadline guard bounds whether such a call may be *started*, not how long it may
        // take — nothing in gg can cut a tool call short, on this path or the native one, and the
        // budget is what the loop stops at the next turn boundary either way. Every one of those
        // children's events therefore lands inside this call's API bracket, which is what the
        // opening half being emitted before the work is for.
        self.recorded(DELEGATION_WAIT_FOR_SUBAGENTS, |state, rec| {
            let outcome = state.call(rec, DELEGATION_WAIT_FOR_SUBAGENTS, |api| {
                api.wait_for_subagents(ids)
            })?;
            match outcome.data {
                Some(ToolData::SubagentResults(results)) => Ok(results
                    .into_iter()
                    .map(
                        |SubagentResultData {
                             id,
                             status: ending,
                             summary,
                         }| SubagentResult {
                            id,
                            status: ending.map(status),
                            summary,
                        },
                    )
                    .collect()),
                other => Err(state.missing_data(DELEGATION_WAIT_FOR_SUBAGENTS, other.as_ref())),
            }
        })
    }

    fn send_message(&mut self, agent_id: String, message: String) -> Result<(), ToolError> {
        self.recorded(DELEGATION_SEND_MESSAGE, |state, rec| {
            state.call(rec, DELEGATION_SEND_MESSAGE, |api| {
                api.send_message(agent_id, message)
            })?;
            Ok(())
        })
    }

    /// Declare a move to another state of the machine driving this agent.
    ///
    /// Nothing happens here beyond the check: like `compact`, the call validates the target against
    /// the state's declared edges and records the request, and the loop performs the succession once
    /// the program has ended. Replacing the agent — and the very window the program is composing
    /// into — mid-execution would pull every remaining call out from under it. Success carries no
    /// payload; what the successor received is told to *it*, in the note it opens on.
    fn transition_state(&mut self, target: String, note: Option<String>) -> Result<(), ToolError> {
        self.recorded(DELEGATION_TRANSITION_STATE, |state, rec| {
            state.call(rec, DELEGATION_TRANSITION_STATE, |api| {
                api.transition_state(target, note)
            })?;
            Ok(())
        })
    }

    /// Declare that this session continues as another agent.
    ///
    /// The same shape as `transition_state` above, because it is the same succession: nothing
    /// happens here beyond the check, and the loop performs it once the program has ended. Success
    /// carries no payload — what the successor received is told to *it*, in the note it opens on,
    /// and this program will not be running by the time there is anything to report.
    fn exec(&mut self, agent: String, prompt: Option<String>) -> Result<(), ToolError> {
        self.recorded(DELEGATION_EXEC, |state, rec| {
            state.call(rec, DELEGATION_EXEC, |api| api.exec(agent, prompt))?;
            Ok(())
        })
    }

    /// Register a copy of this agent and hand back its handle.
    ///
    /// It reads back the very sidecar `spawn_subagent` produces, and deliberately so: a copy is an
    /// ordinary child from the moment it starts, and a program that has one should be able to name
    /// it, wait on it and message it with the code it already has for children.
    fn fork(&mut self, prompt: String) -> Result<SubagentHandle, ToolError> {
        self.recorded(DELEGATION_FORK, |state, rec| {
            let outcome = state.call(rec, DELEGATION_FORK, |api| api.fork(prompt))?;
            match outcome.data {
                Some(ToolData::SubagentSpawned(SubagentHandleData { id, slot, model_id })) => {
                    Ok(SubagentHandle { id, slot, model_id })
                }
                other => Err(state.missing_data(DELEGATION_FORK, other.as_ref())),
            }
        })
    }
}

/// A brief as the schema's two mutually exclusive keys: exactly one is a string and the other is
/// null, which is the whole point of the variant — "neither" is not representable.
fn brief(task: SubagentBrief) -> (Option<String>, Option<String>) {
    match task {
        SubagentBrief::Prompt(prompt) => (Some(prompt), None),
        SubagentBrief::Issue(issue) => (None, Some(issue)),
    }
}

/// How a child agent finished, in the membrane's vocabulary.
///
/// Exhaustive with no wildcard, which is the point: gg's status vocabulary and the WIT's have to move
/// together, and a new ending that reached a program as `none` would tell it a falsehood about a
/// child that produced a perfectly good summary. The compiler is what enforces that here.
fn status(status: AgentStatusData) -> AgentStatus {
    match status {
        AgentStatusData::Completed => AgentStatus::Completed,
        AgentStatusData::Exhausted => AgentStatus::Exhausted,
        AgentStatusData::TimedOut => AgentStatus::TimedOut,
        AgentStatusData::ModelError => AgentStatus::ModelError,
        AgentStatusData::AuthError => AgentStatus::AuthError,
        AgentStatusData::LimitExceeded => AgentStatus::LimitExceeded,
    }
}

#[cfg(test)]
#[path = "delegation.test.rs"]
mod tests;
