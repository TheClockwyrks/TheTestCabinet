//! The membrane's delegation family: spawning child agents, waiting for them, messaging them, and
//! the two declarative fan-outs (`run_workflow`, `speculate`).
//!
//! These five are the reason the bridge under this membrane is a channel to the async loop rather
//! than a direct call into the tool registry: a delegation call is serviced by the **subagent
//! scheduler**, on the loop, with the agent tree and the parallelism cap it owns. A program's
//! `spawnSubagent` therefore behaves exactly as a native `spawn_subagent` does, including its depth
//! cap and its worktree isolation — the only difference is that a program can compose the results.
//!
//! Two lowerings live here. A brief is a **variant**, so "neither a prompt nor an issue" — which
//! today's JSON schema allows and rejects only at run time, wasting a call — cannot be expressed at
//! all. And `attempts` is clamped into 2–6 here as well as in the loop, because the WIT's `u8`
//! admits values the loop would otherwise have to reject after the model had already committed to
//! them.
//!
//! # These four sidecars are produced by the loop, not by a tool
//!
//! `spawn_subagent`, `wait_for_subagents`, `run_workflow` and `speculate` never reach a
//! [`Tool`](crate::tools::Tool) at all: the loop's servicing seam recognises them and routes them to
//! the subagent scheduler, so the [`ToolData`] each of them reads back is attached **there**. Until
//! that seam attaches it, every one of these functions reports `missing_data` — and the tests below
//! pass regardless, because their fake invoker supplies the sidecar the real system has to. Read a
//! green suite here as "the conversion is right", never as "the producer exists".

use serde_json::{Value, json};

use super::MembraneState;
use super::test_cabinet::gg::delegation::{
    AgentStatus, Host as DelegationHost, SpawnRequest, SpeculateRequest, SpeculationReport,
    SubagentBrief, SubagentHandle, SubagentResult, WorkflowReport, WorkflowStage,
};
use super::test_cabinet::gg::types::ToolError;
use crate::tools::{
    AgentStatusData, RUN_WORKFLOW_TOOL, SEND_MESSAGE_TOOL, SPAWN_SUBAGENT_TOOL, SPECULATE_TOOL,
    SpeculationData, SubagentHandleData, SubagentResultData, ToolData, WAIT_FOR_SUBAGENTS_TOOL,
    WorkflowData,
};

/// How many attempts a `speculate` with no count makes — the loop's own default, restated because
/// the membrane resolves the option before the loop ever sees the call.
const DEFAULT_SPECULATION_ATTEMPTS: u8 = 2;

/// The fewest attempts that are best-of-anything.
const MIN_SPECULATION_ATTEMPTS: u8 = 2;

/// The most attempts one `speculate` may fan out to — the loop's ceiling, applied here so a program
/// that asks for twenty gets six rather than an argument error.
const MAX_SPECULATION_ATTEMPTS: u8 = 6;

impl DelegationHost for MembraneState {
    fn spawn_subagent(&mut self, request: SpawnRequest) -> Result<SubagentHandle, ToolError> {
        let (prompt, issue_id) = brief(request.task);
        let outcome = self.call(
            SPAWN_SUBAGENT_TOOL,
            json!({
                "prompt": prompt,
                "issueId": issue_id,
                "slot": request.slot,
                "worktree": request.worktree,
            }),
        )?;
        // Every payload here is destructured field by field rather than read through dots, so a
        // field added to one fails to compile at the membrane — which is where someone has to
        // decide whether a program should be able to see it.
        match outcome.data {
            Some(ToolData::SubagentSpawned(SubagentHandleData {
                id,
                slot,
                model_id,
                worktree_branch,
            })) => Ok(SubagentHandle {
                id,
                slot,
                model_id,
                worktree_branch,
            }),
            other => Err(self.missing_data(SPAWN_SUBAGENT_TOOL, other.as_ref())),
        }
    }

    fn wait_for_subagents(
        &mut self,
        ids: Option<Vec<String>>,
    ) -> Result<Vec<SubagentResult>, ToolError> {
        // This blocks while the children run, and the run's wall-clock budget keeps running with
        // it. The deadline guard bounds whether such a call may be *started*, not how long it may
        // take — nothing in gg can cut a tool call short, on this path or the native one, and the
        // budget is what the loop stops at the next turn boundary either way.
        let outcome = self.call(WAIT_FOR_SUBAGENTS_TOOL, json!({ "ids": ids }))?;
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
            other => Err(self.missing_data(WAIT_FOR_SUBAGENTS_TOOL, other.as_ref())),
        }
    }

    fn send_message(&mut self, agent_id: String, message: String) -> Result<(), ToolError> {
        self.call(
            SEND_MESSAGE_TOOL,
            json!({ "agentId": agent_id, "message": message }),
        )?;
        Ok(())
    }

    fn run_workflow(&mut self, stages: Vec<WorkflowStage>) -> Result<WorkflowReport, ToolError> {
        let stages: Vec<Value> = stages
            .into_iter()
            .map(|stage| {
                json!({
                    "name": stage.name,
                    "prompt": stage.prompt,
                    // `none` (fan out over the previous stage's results) and an EMPTY list (an
                    // error) are different requests, so the option is lowered as it stands: a
                    // missing `items` becomes JSON null, an empty one becomes `[]`.
                    "items": stage.items,
                    "slot": stage.slot,
                    "worktree": stage.worktree,
                })
            })
            .collect();
        let outcome = self.call(RUN_WORKFLOW_TOOL, json!({ "stages": stages }))?;
        match outcome.data {
            Some(ToolData::Workflow(WorkflowData {
                workflow_id,
                stages,
                results,
            })) => Ok(WorkflowReport {
                workflow_id,
                stages,
                results,
            }),
            other => Err(self.missing_data(RUN_WORKFLOW_TOOL, other.as_ref())),
        }
    }

    fn speculate(&mut self, request: SpeculateRequest) -> Result<SpeculationReport, ToolError> {
        let (prompt, issue_id) = brief(request.task);
        let attempts = request
            .attempts
            .unwrap_or(DEFAULT_SPECULATION_ATTEMPTS)
            .clamp(MIN_SPECULATION_ATTEMPTS, MAX_SPECULATION_ATTEMPTS);
        let outcome = self.call(
            SPECULATE_TOOL,
            json!({
                "prompt": prompt,
                "issueId": issue_id,
                "attempts": attempts,
                "approaches": request.approaches,
                "slots": request.slots,
            }),
        )?;
        match outcome.data {
            Some(ToolData::Speculation(SpeculationData {
                winner_id,
                attempts,
                rationale,
                summary,
            })) => Ok(SpeculationReport {
                winner_id,
                attempts,
                rationale,
                summary,
            }),
            other => Err(self.missing_data(SPECULATE_TOOL, other.as_ref())),
        }
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
