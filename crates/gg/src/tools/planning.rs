//! The planning tools: `enter_plan_mode` and `submit_plan` — how the model elects a
//! [planning](crate::planning) pass mid-session.
//!
//! Both tools are **loop-coordinated**, like the agent-managed-context reclaim tools: their
//! [`invoke`](Tool::invoke) only *validates* the call (there is nothing for a tool to mutate on
//! its own — plan mode and the context reset are properties of the live
//! [loop](crate::agent) and its context window, which a tool cannot hold), and the loop applies
//! the effect. `enter_plan_mode` flips the loop into read-only mode; `submit_plan` hands the
//! loop the plan text, which it uses to clear the exploration history and seed the fresh
//! implementation context.
//!
//! The loop enforces the plan-mode preconditions (you cannot `submit_plan` unless you are in
//! plan mode; you cannot re-`enter_plan_mode` while already in it) and the read-only toolset
//! restriction; these tools are the model-facing surface for those transitions.
//!
//! The tools are contributed to the registry only when the
//! [`planning`](test_cabinet_core::gg::CAPABILITY_PLANNING) capability is enabled; when it is
//! off, neither is offered (ablation).

use async_trait::async_trait;
use serde_json::{Value, json};

use super::{Tool, ToolContext, ToolOutcome, invalid_argument, required_str};
use crate::model::ToolDefinition;

/// The `enter_plan_mode` tool name.
pub const ENTER_PLAN_MODE_TOOL: &str = "enter_plan_mode";
/// The `submit_plan` tool name.
pub const SUBMIT_PLAN_TOOL: &str = "submit_plan";

/// Whether `name` is one of the planning tools — the loop uses this to route a successful call
/// to its plan-mode transition.
pub fn is_planning_tool(name: &str) -> bool {
    matches!(name, ENTER_PLAN_MODE_TOOL | SUBMIT_PLAN_TOOL)
}

// ---------------------------------------------------------------------------
// enter_plan_mode
// ---------------------------------------------------------------------------

/// Enters a read-only planning pass.
pub struct EnterPlanModeTool;

#[async_trait]
impl Tool for EnterPlanModeTool {
    fn name(&self) -> &str {
        ENTER_PLAN_MODE_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            ENTER_PLAN_MODE_TOOL,
            "Enter a read-only planning pass. Your tools become restricted to exploration \
             (read_file, list_dir, read_skill, search_archive) — you cannot write, edit, run \
             commands, or change state until you submit a plan. Use this when the work is \
             substantial or unfamiliar and you want to understand it before building. When your \
             plan is ready, call `submit_plan`.",
            json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, _args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // The loop performs the mode switch (it owns the offered toolset); the tool only
        // acknowledges the request.
        ToolOutcome::ok(
            "Entering plan mode. You are now read-only: explore with read_file, list_dir, \
             read_skill, and search_archive, then call `submit_plan` with your plan.",
            "entered plan mode",
        )
    }
}

// ---------------------------------------------------------------------------
// submit_plan
// ---------------------------------------------------------------------------

/// Submits a plan and returns to implementation from a fresh context.
pub struct SubmitPlanTool;

#[async_trait]
impl Tool for SubmitPlanTool {
    fn name(&self) -> &str {
        SUBMIT_PLAN_TOOL
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition::new(
            SUBMIT_PLAN_TOOL,
            "Submit your implementation plan and leave plan mode. gg clears your exploration \
             history (your skills, memories, tasks, and board are kept), seeds your context with \
             the original request plus this plan, and restores your full toolset so you implement \
             from a clean window. Make the plan self-contained: capture everything you learned \
             that implementation will need.",
            json!({
                "type": "object",
                "properties": {
                    "plan": {
                        "type": "string",
                        "description": "The implementation plan: the files to create or change, \
                                        the order of work, and the key decisions."
                    }
                },
                "required": ["plan"],
                "additionalProperties": false
            }),
        )
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolOutcome {
        // Validate the plan is present and non-empty; the loop reads the same argument to seed
        // the fresh context and performs the reset.
        let plan = match required_str(&args, "plan", SUBMIT_PLAN_TOOL) {
            Ok(v) => v,
            Err(error) => return error.into(),
        };
        if plan.trim().is_empty() {
            return invalid_argument(
                "`submit_plan`: `plan` must not be empty — provide the implementation plan.",
            );
        }
        ToolOutcome::ok(
            "Plan accepted. Clearing your exploration and starting implementation from a clean \
             context with the original request and your plan.",
            "submitted plan",
        )
    }
}
