use super::*;
use test_cabinet_core::gg::{CAPABILITY_PLANNING, GgCapabilityConfig, GgCapabilitySet};

/// A disabled runtime offers nothing: no planning tools, and so no prompt section (the
/// [system prompt](crate::prompts::SystemContext::planning) gates its section on this).
#[test]
fn disabled_runtime_offers_no_planning() {
    let runtime = PlanningRuntime::disabled();
    assert!(!runtime.offers_planning());
}

/// `resolve` off (the capability absent) yields a disabled runtime.
#[test]
fn resolve_without_capability_is_disabled() {
    let set = GgCapabilitySet::minimal("mock/x");
    let runtime = PlanningRuntime::resolve(&set);
    assert!(!runtime.offers_planning());
}

/// `resolve` with the capability enabled yields an enabled runtime, which is what turns the
/// system prompt's planning section (advertising both tools) on.
#[test]
fn resolve_with_capability_is_enabled() {
    let mut set = GgCapabilitySet::minimal("mock/x");
    set.capabilities
        .push(GgCapabilityConfig::enabled(CAPABILITY_PLANNING));
    let runtime = PlanningRuntime::resolve(&set);
    assert!(runtime.offers_planning());
}

/// The default planner's guidance tells the model it is read-only and how to submit; its plan
/// framing carries the plan verbatim and orients the model to implement.
#[test]
fn default_planner_guidance_and_framing() {
    let planner = DefaultPlanner;
    let guidance = planner.plan_mode_guidance();
    assert!(guidance.to_lowercase().contains("read-only"));
    assert!(guidance.contains("submit_plan"));

    let framed = planner.frame_plan("  Do the thing.  ");
    // The plan text is carried through (trimmed) and framed as an implementation plan.
    assert!(framed.contains("Do the thing."));
    assert!(framed.to_lowercase().contains("implement"));
}

/// An unrecognized implementation falls back to the default planner rather than failing.
#[test]
fn resolve_planner_falls_back_to_default() {
    // Every arm returns a usable planner; the unrecognized one must still produce guidance.
    for implementation in [None, Some("default"), Some("not-a-real-planner")] {
        let planner = resolve_planner(implementation);
        assert!(!planner.plan_mode_guidance().is_empty());
        assert!(planner.frame_plan("x").contains('x'));
    }
}

/// The runtime delegates guidance and framing to its planner.
#[test]
fn runtime_delegates_to_planner() {
    let runtime = PlanningRuntime::new(Box::new(DefaultPlanner));
    assert_eq!(
        runtime.plan_mode_guidance(),
        DefaultPlanner.plan_mode_guidance()
    );
    assert_eq!(runtime.frame_plan("p"), DefaultPlanner.frame_plan("p"));
}
