// Barrel for the gg run-execution pages. gg is The Test Cabinet's own headless
// harness (its own run mode: a capability set instead of a
// harness/model/orchestrator tuple), so its config + monitor pages live in this
// sibling folder — the console is the only way to configure, launch, and watch a
// gg run. See apps/docs `gg/`.
export { NewGgRunPage } from "./NewGgRunPage";
export { GgRunMonitorPage } from "./GgRunMonitorPage";
export { ggRoutes } from "./router";
