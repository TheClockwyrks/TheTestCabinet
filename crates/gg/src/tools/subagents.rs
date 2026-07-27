//! The subagent tools: `spawn_subagent`, `wait_for_subagents`, and `send_message` — how the
//! model **delegates** to child agents (the [subagents](https://docs.testcabinet.ai/gg/subagents/)
//! capability).
//!
//! Unlike the workspace tools, these are **not** self-contained: spawning, waiting, and messaging
//! act on the live [subagent scheduler](crate::subagents) and the agent tree, which a [`Tool`]
//! (which only sees its parsed args and the workspace [`ToolContext`]) cannot reach. So — like the
//! [planning](crate::tools::planning) and [agent-managed-context](crate::tools::context) tools —
//! the [turn loop](crate::agent) **intercepts** these calls and performs the real work against the
//! orchestrator; the [`Tool`] implementations here exist only to **declare** the tools to the
//! model (their name, description, and schema, so toolset ablation and the system-prompt listing
//! work uniformly). Their [`invoke`](Tool::invoke) is a defensive fallback that never runs in a
//! correctly wired session (whenever these tools are offered, the loop holds the subagent runtime
//! and handles them before dispatch).
//!
//! The tools are contributed to the registry only when the
//! [`subagents`](test_cabinet_core::gg::CAPABILITY_SUBAGENTS) capability is enabled; when it is
//! off, none are offered (ablation), and a run stays single-agent.

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome};
use crate::model::ToolDefinition;

/// The `spawn_subagent` tool name.
pub const SPAWN_SUBAGENT_TOOL: &str = "spawn_subagent";
/// The `wait_for_subagents` tool name.
pub const WAIT_FOR_SUBAGENTS_TOOL: &str = "wait_for_subagents";
/// The `send_message` tool name.
pub const SEND_MESSAGE_TOOL: &str = "send_message";
/// The `run_workflow` tool name.
pub const RUN_WORKFLOW_TOOL: &str = "run_workflow";
/// The `speculate` tool name.
pub const SPECULATE_TOOL: &str = "speculate";

/// Whether `name` is one of the delegation tools the [loop](crate::agent) **intercepts** — the
/// ad-hoc subagent tools (`spawn_subagent`/`wait_for_subagents`/`send_message`) or the declared
/// [`run_workflow`](RUN_WORKFLOW_TOOL) — routing the call to the
/// [orchestrator](crate::agent) instead of ordinary [dispatch](super::ToolRegistry::dispatch).
/// All of them act on the scheduler and the agent tree, which a self-contained [`Tool`] cannot
/// reach.
pub fn is_subagent_tool(name: &str) -> bool {
    matches!(
        name,
        SPAWN_SUBAGENT_TOOL | WAIT_FOR_SUBAGENTS_TOOL | SEND_MESSAGE_TOOL | RUN_WORKFLOW_TOOL
    )
}

/// The model-facing error returned if a subagent tool is ever dispatched normally (it should be
/// intercepted by the loop). Never seen in a correctly wired session.
fn handled_by_loop(name: &str) -> ToolOutcome {
    ToolOutcome::error(format!(
        "`{name}` is a delegation tool handled by the gg runtime; it cannot be dispatched here."
    ))
}

/// Declares `spawn_subagent` — schedule a child agent and return immediately.
pub struct SpawnSubagentTool;

#[async_trait]
impl Tool for SpawnSubagentTool {
    fn name(&self) -> &str {
        SPAWN_SUBAGENT_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SPAWN_SUBAGENT_TOOL,
            "Delegate a scoped piece of work to a child agent that runs in parallel with you. \
             Provide a `prompt` — a self-contained brief telling the subagent exactly what to do \
             and what 'done' means. (Board issues are not dispatched this way: submitting an issue \
             automatically spawns an agent for it once its blockers are done.) Optionally pass a \
             `slot` to run the subagent on a different model slot (only takes effect when \
             multi-model is enabled; otherwise it runs on the primary model). Optionally pass \
             `worktree: true` to run the subagent in an isolated copy of the workspace (a git \
             worktree) instead of the shared tree — its file changes are invisible to you and to \
             sibling agents until it finishes, and are then merged back into the workspace if it \
             completes cleanly (a merge conflict is reported back to you, not dropped) or discarded \
             if it fails. Use a worktree when you run several subagents that might touch the same \
             files, or want a throwaway attempt; it requires the `worktrees` capability. Returns \
             the new subagent's id immediately — it is scheduled and runs on its own; call \
             `wait_for_subagents` to collect its result, or `send_message` to guide it while it \
             runs. Subagents that share your workspace (no worktree) should be given \
             non-overlapping briefs. Spawning is refused if you are already at the maximum \
             delegation depth.",
            json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "A self-contained brief for the subagent (what to do and \
                                        how it will be judged done)."
                    },
                    "slot": {
                        "type": "string",
                        "description": "Optional model slot to run the subagent on (for example \
                                        `subagent` or `reviewer`); only honored when multi-model \
                                        is enabled, else the primary model is used."
                    },
                    "worktree": {
                        "type": "boolean",
                        "description": "Run the subagent in an isolated git worktree (a private \
                                        copy of the workspace) instead of the shared tree, merged \
                                        back on clean completion. Requires the `worktrees` \
                                        capability. Defaults to false (shares your workspace)."
                    }
                },
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(SPAWN_SUBAGENT_TOOL)
    }
}

/// Declares `wait_for_subagents` — block until named (or all) children return, then collect them.
pub struct WaitForSubagentsTool;

#[async_trait]
impl Tool for WaitForSubagentsTool {
    fn name(&self) -> &str {
        WAIT_FOR_SUBAGENTS_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            WAIT_FOR_SUBAGENTS_TOOL,
            "Wait for one or more of your subagents to finish and collect their return values. \
             Pass `ids` (a list of subagent ids) to wait for specific children, or omit it to \
             wait for all of your outstanding subagents. While you wait you free your run slot so \
             your subagents (and other agents) can run; you resume once the awaited subagents have \
             all returned. The result contains each subagent's final message.",
            json!({
                "type": "object",
                "properties": {
                    "ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional ids of the subagents to wait for (omit to wait \
                                        for all outstanding ones)."
                    }
                },
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(WAIT_FOR_SUBAGENTS_TOOL)
    }
}

/// Declares `send_message` — deliver a message to a running child's inbox.
pub struct SendMessageTool;

#[async_trait]
impl Tool for SendMessageTool {
    fn name(&self) -> &str {
        SEND_MESSAGE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SEND_MESSAGE_TOOL,
            "Send a message to one of your running subagents. Provide the subagent's `agentId` \
             and the `message` text. The subagent receives your message at its next turn (as a \
             message from you), so you can course-correct or add context while it works. Fails if \
             the agent is not one of your subagents or has already returned.",
            json!({
                "type": "object",
                "properties": {
                    "agentId": {
                        "type": "string",
                        "description": "The id of the subagent to message (one you spawned)."
                    },
                    "message": {
                        "type": "string",
                        "description": "The message to deliver to the subagent."
                    }
                },
                "required": ["agentId", "message"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(SEND_MESSAGE_TOOL)
    }
}

/// Declares `run_workflow` — run a declared, multi-stage subagent fan-out as one unit.
pub struct RunWorkflowTool;

#[async_trait]
impl Tool for RunWorkflowTool {
    fn name(&self) -> &str {
        RUN_WORKFLOW_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            RUN_WORKFLOW_TOOL,
            "Run a declared, multi-stage workflow of subagents as a single unit — fan-out plus \
             sequencing — instead of spawning and waiting on subagents by hand. You provide an \
             ordered list of `stages`; gg runs them in order, and this call returns only when the \
             whole workflow is done, with the final stage's results. Each stage FANS OUT one \
             subagent per item and runs them in parallel (under the same global concurrency and \
             depth limits as ad-hoc subagents — a workflow gets no extra budget), waits for all of \
             them, then feeds their results into the next stage (SEQUENCING). A stage's `prompt` is \
             a template applied once per item to form that subagent's brief: write `{{item}}` where \
             the item text should go, and `{{prior}}` where the previous stage's collected results \
             should go. The FIRST stage must list its `items` explicitly; a later stage that omits \
             `items` fans out over the previous stage's results (one subagent per result, each \
             seeing its result as `{{item}}`) — or give it a single item and reference `{{prior}}` \
             to have one subagent consolidate all of the previous stage's results. Optionally set a \
             stage's `slot` (a model slot, honored only when multi-model is enabled) or \
             `worktree: true` (run each of that stage's subagents in its own isolated git worktree, \
             merged back on clean completion; requires the `worktrees` capability). Use a workflow \
             when the work has a clear map-then-reduce or pipeline shape; use `spawn_subagent` for \
             ad-hoc delegation.",
            json!({
                "type": "object",
                "properties": {
                    "stages": {
                        "type": "array",
                        "minItems": 1,
                        "description": "The workflow's stages, run in order; each fans out over its \
                                        items and feeds the next stage.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "A short name for the stage (used in the \
                                                    timeline; defaults to `stage-N`)."
                                },
                                "prompt": {
                                    "type": "string",
                                    "description": "The per-item brief template. `{{item}}` is \
                                                    replaced with the item; `{{prior}}` with the \
                                                    previous stage's collected results."
                                },
                                "items": {
                                    "type": "array",
                                    "items": { "type": "string" },
                                    "description": "The items to fan out over (one subagent each). \
                                                    Required on the first stage; on a later stage, \
                                                    omit it to fan out over the previous stage's \
                                                    results."
                                },
                                "slot": {
                                    "type": "string",
                                    "description": "Optional model slot for this stage's subagents \
                                                    (honored only when multi-model is enabled)."
                                },
                                "worktree": {
                                    "type": "boolean",
                                    "description": "Run each of this stage's subagents in an \
                                                    isolated git worktree, merged back on clean \
                                                    completion. Requires the `worktrees` \
                                                    capability. Defaults to false."
                                }
                            },
                            "required": ["prompt"],
                            "additionalProperties": false
                        }
                    }
                },
                "required": ["stages"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(RUN_WORKFLOW_TOOL)
    }
}

/// Declares `speculate` — attempt the same task K times in parallel (best-of-K) and keep the best.
pub struct SpeculateTool;

#[async_trait]
impl Tool for SpeculateTool {
    fn name(&self) -> &str {
        SPECULATE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SPECULATE_TOOL,
            "Attempt the same piece of work several times in parallel and keep only the BEST result \
             (best-of-K). Provide a `prompt` — a self-contained brief for the task — OR an `issueId` \
             to speculate on one of your board issues (its scope and completion criteria become the \
             task), and `attempts` (K, the number of parallel tries, 2–6). gg fans out K subagents at \
             the SAME task, EACH IN ITS OWN ISOLATED WORKTREE so they cannot collide, runs them in \
             parallel under the same concurrency and depth limits as ordinary subagents (no extra \
             budget), then a JUDGE scores their work against the task's completion criteria and picks \
             a winner. gg MERGES the winner's worktree back into your workspace and DISCARDS the \
             losing attempts — so when this call returns, your workspace holds exactly the winning \
             attempt's changes. Optionally pass `approaches` (an array of hints, one per attempt, to \
             steer the tries in different directions) and/or `slots` (an array of model slots, one \
             per attempt, honored only when multi-model is enabled). Requires the `worktrees` \
             capability (for isolation); refused without it. Use this for a hard or open-ended piece \
             of work where one careful attempt may not be enough and you can afford K× the tokens for \
             a better result; use `spawn_subagent` for ordinary single-attempt delegation. This call \
             returns only when the winner has been merged.",
            json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "A self-contained brief for the task to attempt K times \
                                        (what to do and how it will be judged done). Provide this \
                                        or `issueId`."
                    },
                    "issueId": {
                        "type": "string",
                        "description": "The id of a board issue to speculate on; its scope and \
                                        completion criteria become the task."
                    },
                    "attempts": {
                        "type": "integer",
                        "minimum": 2,
                        "maximum": 6,
                        "description": "K — how many parallel attempts to make (2–6). Defaults to 2."
                    },
                    "approaches": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional per-attempt approach hints, one per attempt, to \
                                        steer the tries in different directions (extra attempts \
                                        beyond the list get no hint)."
                    },
                    "slots": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional per-attempt model slots, one per attempt (honored \
                                        only when multi-model is enabled; otherwise all attempts \
                                        run on the primary model)."
                    }
                },
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        handled_by_loop(SPECULATE_TOOL)
    }
}
