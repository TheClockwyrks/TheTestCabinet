// Barrel for the gg run-execution pages. gg is The Test Cabinet's own headless
// harness (its own run mode: a capability set instead of a
// harness/model/orchestrator tuple), so its monitor and replay pages live in this
// sibling folder — the console is the only way to configure, launch, and watch a gg
// run. The capability-set editor lives here too (mounted by the account section's
// gg tab, since a saved configuration is what a run is launched from), while the
// cross-run analysis surfaces are their own `/gg` section. See apps/docs `gg/`.
export { GgRunMonitorPage } from "./GgRunMonitorPage";
export { GgReplayView } from "./GgReplayView";
export { GgConfigEditor } from "./GgConfigEditor";
export { ggRoutes } from "./router";
