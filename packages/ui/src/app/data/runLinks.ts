// Where a run's own page lives — the one place that decides it, so every list,
// menu, and notification lands an operator on the same view.
//
// gg is the reason this is not just `routes.runMonitor`/`routes.runDetail`: The Test
// Cabinet's own harness streams first-party telemetry, and its runs are watched and
// read through gg's rich, capability-shaped views rather than a generic harness event
// feed. A gg run reached from the runs list must land there too, or the rich view
// would exist only for whoever happened to launch the run.

import { routes } from "../routes";

/** The harness slug a gg run records. */
export const GG_HARNESS_SLUG = "gg";

/** Whether a run was conducted by gg, from the harness slug it records. */
export function isGgRun(harnessSlug: string | null | undefined): boolean {
  return harnessSlug === GG_HARNESS_SLUG;
}

/**
 * Where an in-flight run is watched: gg's own live monitor for a gg run, the
 * conventional harness monitor for everything else.
 */
export function runLivePath(
  runId: string,
  harnessSlug: string | null | undefined,
): string {
  return isGgRun(harnessSlug)
    ? routes.ggMonitor(runId)
    : routes.runMonitor(runId);
}

/**
 * A run's own page: its live monitor while it is still executing (gg's, for a gg
 * run), otherwise its detail page.
 *
 * A finished run leads with its default tab whatever its harness — a gg run's rich
 * view is a tab on that page, one click away, rather than a different landing spot
 * for one harness.
 */
export function runPagePath(
  runId: string,
  harnessSlug: string | null | undefined,
  active: boolean,
): string {
  return active ? runLivePath(runId, harnessSlug) : routes.runDetail(runId);
}
