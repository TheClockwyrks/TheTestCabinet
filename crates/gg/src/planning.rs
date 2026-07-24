//! The gg **planning** capability: a **read-only planning pass** followed by a
//! **fresh-context implementation pass**, reachable mid-session as a tool.
//!
//! [Planning](https://docs.testcabinet.ai/gg/planning/) lets an agent that started *not* in
//! plan mode decide, mid-session, to stop and plan. It calls `enter_plan_mode`, which puts the
//! [loop](crate::agent) into a **read-only mode** — only non-mutating tools (`read_file`,
//! `list_dir`, `read_skill`, `search_archive`) are offered, so the agent can explore and reason
//! but not touch the workspace or its state. It then calls `submit_plan { plan }`, at which
//! point gg **clears the exploration history** — keeping the pinned prefix (system prompt, the
//! original build prompt, read skills, memories, tasks, the board) verbatim via the shared
//! [context-reset primitive](crate::context::ContextModel::clear_ephemeral) — and seeds a fresh
//! implementation context from the original prompt plus the plan (pinned), restores the full
//! (mutating) toolset, and lets the loop implement from a clean window.
//!
//! The value is that implementation starts from a compact, deliberate plan rather than from a
//! context window already cluttered with exploration.
//!
//! # The swappable planner
//!
//! *What* the plan-mode guidance says and *how* the plan is framed on re-entry are a
//! **swappable strategy** behind the [`Planner`] trait, selected by the capability's
//! [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation) — different
//! planning prompts and structures are exactly the kind of thing gg exists to compare. The
//! default is [`DefaultPlanner`]; [`resolve_planner`] is the drop-in seam for alternates.
//!
//! # Reused by the FSM (Phase 5)
//!
//! Phase 5's plan-first [FSM](https://docs.testcabinet.ai/gg/fsms/) drives an agent through the
//! same two states (plan → implement). It reuses this exact mechanism — the read-only toolset
//! restriction, the [`Planner`], and the context reset — rather than a parallel one; the loop's
//! plan-mode handling is written so the FSM can drive it the same way the tool does.
//!
//! The capability is **ablatable**: when it is off the loop builds a
//! [`disabled`](PlanningRuntime::disabled) runtime, so there are no planning tools, no prompt
//! section, no read-only mode, and no telemetry — the feature vanishes.

use test_cabinet_core::gg::{CAPABILITY_PLANNING, GgCapabilitySet};

/// A **swappable** planning strategy for [planning](https://docs.testcabinet.ai/gg/planning/).
///
/// A planner supplies the two pieces of prose that shape a planning pass: the
/// [guidance](Self::plan_mode_guidance) shown to the agent while it is in read-only plan mode,
/// and how the accepted plan is [framed](Self::frame_plan) as the pinned item that seeds the
/// fresh implementation context. Both are drop-in so a study can compare planning prompts by
/// [selecting an implementation](resolve_planner) without touching the loop. `Send + Sync` so a
/// boxed planner can back the async loop.
pub trait Planner: Send + Sync {
    /// The guidance injected into the context when the agent **enters** plan mode: it tells the
    /// agent it is now read-only, that it should explore and reason about a plan, and that it
    /// submits the plan with `submit_plan` — at which point its exploration is cleared and it
    /// implements from a clean window.
    fn plan_mode_guidance(&self) -> String;

    /// Frame the submitted `plan` as the prominent, pinned item that seeds the fresh
    /// implementation context — a heading that orients the agent (its exploration was cleared;
    /// the original build request is still above; implement the plan below) followed by the
    /// plan verbatim.
    fn frame_plan(&self, plan: &str) -> String;
}

/// The default [`Planner`]: a general-purpose read-only planning pass suitable for any build.
#[derive(Debug, Default, Clone, Copy)]
pub struct DefaultPlanner;

impl Planner for DefaultPlanner {
    fn plan_mode_guidance(&self) -> String {
        "# Plan mode (read-only)\n\nYou are now in **plan mode**. Your tools are restricted to \
         read-only exploration — you can `read_file`, `list_dir`, `read_skill`, and \
         `search_archive`, but you cannot write, edit, run commands, or change any state. Use \
         this pass to understand the workspace and think the work through.\n\nProduce a concrete \
         implementation plan: the files you will create or change, the order you will do the \
         work in, and the key decisions. When your plan is ready, call `submit_plan` with the \
         plan text. Submitting **clears this exploration from your context** and starts you fresh \
         with just the original request and your plan, so make the plan self-contained — capture \
         everything you learned that implementation will need."
            .to_string()
    }

    fn frame_plan(&self, plan: &str) -> String {
        format!(
            "# Implementation plan\n\nYou completed a read-only planning pass and submitted the \
             plan below. Your exploration has been cleared to give you a clean window; the \
             original build request is still above. Implement this plan now — you have your full \
             toolset back. If you discover the plan needs to change as you go, adapt it.\n\n{}",
            plan.trim()
        )
    }
}

/// Select the [`Planner`] for a planning capability's
/// [`implementation`](test_cabinet_core::gg::GgCapabilityConfig::implementation). `None` (or an
/// unrecognized name) selects the default [`DefaultPlanner`]; the match is the drop-in seam for
/// alternate planning prompts/structures.
pub fn resolve_planner(implementation: Option<&str>) -> Box<dyn Planner> {
    match implementation {
        // The only strategy in P3b; future planners add arms here.
        Some("default") | None => Box::new(DefaultPlanner),
        // An unrecognized implementation falls back to the default rather than failing to
        // launch — a study naming a not-yet-built planner still runs.
        Some(_) => Box::new(DefaultPlanner),
    }
}

/// The system-prompt section telling the model the planning tools exist and when to reach for
/// them. The plan-mode guidance and the accepted plan are injected into the *context* (by the
/// loop, from the [`Planner`]); this is only the up-front advertisement of the capability.
const PLANNING_PROMPT: &str = "For substantial or unfamiliar work you can **plan before you \
    build**. Call `enter_plan_mode` to enter a read-only planning pass: your tools are restricted \
    to exploration (read files, list directories, read skills, search your archive) so you can \
    understand the workspace and think without touching it. When your plan is ready, call \
    `submit_plan` with the plan — gg then clears your exploration history (your skills, memories, \
    tasks, and board are kept), seeds your context with the original request plus your plan, and \
    restores your full toolset so you implement from a clean, deliberate starting point.";

/// The loop's live view of the planning capability: whether it is on and the selected
/// [`Planner`].
///
/// Constructed [enabled](Self::new) with a planner or [disabled](Self::disabled) (an ablation's
/// off arm). It supplies the loop with the system-prompt [section](Self::prompt_section), the
/// plan-mode [guidance](Self::plan_mode_guidance) injected on entry, and the accepted-plan
/// [framing](Self::frame_plan) used to seed the fresh implementation context.
pub struct PlanningRuntime {
    /// Whether the planning capability is enabled for this run.
    enabled: bool,
    /// The selected planning strategy.
    planner: Box<dyn Planner>,
}

impl PlanningRuntime {
    /// An enabled runtime backed by `planner`.
    pub fn new(planner: Box<dyn Planner>) -> Self {
        Self {
            enabled: true,
            planner,
        }
    }

    /// A disabled runtime (the capability is off): no planning tools, no prompt section, no
    /// read-only mode, no telemetry. Carries the default planner so its accessors are total, but
    /// they are never consulted while disabled.
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            planner: Box::new(DefaultPlanner),
        }
    }

    /// Resolve the runtime from a run's capability set: enabled when the
    /// [planning](CAPABILITY_PLANNING) capability is present and on, with its
    /// [planner](resolve_planner) read from its `implementation`; otherwise
    /// [disabled](Self::disabled).
    pub fn resolve(set: &GgCapabilitySet) -> Self {
        if !set.is_enabled(CAPABILITY_PLANNING) {
            return Self::disabled();
        }
        let planner = resolve_planner(
            set.capability(CAPABILITY_PLANNING)
                .and_then(|cap| cap.implementation.as_deref()),
        );
        Self::new(planner)
    }

    /// Whether the capability offers the planning tools this run (simply whether it is enabled).
    pub fn offers_planning(&self) -> bool {
        self.enabled
    }

    /// The system-prompt section advertising the planning tools, or `None` when the capability
    /// is off.
    pub fn prompt_section(&self) -> Option<String> {
        self.enabled.then(|| PLANNING_PROMPT.to_string())
    }

    /// The plan-mode guidance the loop injects into the context when the agent enters plan mode.
    pub fn plan_mode_guidance(&self) -> String {
        self.planner.plan_mode_guidance()
    }

    /// Frame `plan` as the pinned item that seeds the fresh implementation context.
    pub fn frame_plan(&self, plan: &str) -> String {
        self.planner.frame_plan(plan)
    }
}

#[cfg(test)]
#[path = "planning.test.rs"]
mod tests;
