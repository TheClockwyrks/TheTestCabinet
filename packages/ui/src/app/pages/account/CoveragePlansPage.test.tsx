import { describe, expect, it } from "vitest";
import type { CoveragePlanSummary } from "@test-cabinet/run-record/coverage";
import { planProgress } from "./CoveragePlansPage";

// A plan card's bar tracks how many of the wanted runs exist, not how many cells
// have already hit the target — raising the target on a covered plan has to read as
// "partly there", never as an empty bar.

// A plan of `cells` cells at `runsPerCell`, with every cell holding `have` runs
// (completed or in flight), which is what the backend's `runsMissing` sums up.
function summary(
  cells: number,
  runsPerCell: number,
  have: number,
): CoveragePlanSummary {
  const perCellMissing = Math.max(0, runsPerCell - have);
  return {
    id: "p1",
    name: "v0.6.x sweep",
    runsPerCell,
    cellsSatisfied: cells * (perCellMissing === 0 ? 1 : 0),
    cellsTotal: cells,
    runsMissing: cells * perCellMissing,
    // The scheduling fields are irrelevant to the progress bar — it measures runs
    // that exist, not whether the plan is still feeding itself — so they take the
    // values a plan has before anyone touches its schedule.
    runsUnreviewed: 0,
    paused: false,
    autoTopUp: false,
  };
}

describe("planProgress", () => {
  it("counts the runs already there when the target is raised past them", () => {
    // Six cells covered twice over: satisfied at a target of 2…
    expect(planProgress(summary(6, 2, 2))).toEqual({
      runsDone: 12,
      runsTotal: 12,
      donePct: 100,
    });
    // …and two thirds of the way there once the target moves to 3 — not empty,
    // even though no cell is satisfied any more.
    const raised = planProgress(summary(6, 3, 2));
    expect(raised.runsDone).toBe(12);
    expect(raised.runsTotal).toBe(18);
    expect(raised.donePct).toBeCloseTo(66.67, 1);
  });

  it("reads empty for a plan with no runs and full for a satisfied one", () => {
    expect(planProgress(summary(4, 3, 0)).donePct).toBe(0);
    expect(planProgress(summary(4, 3, 3)).donePct).toBe(100);
  });

  it("does not divide by zero on an empty plan", () => {
    expect(planProgress(summary(0, 3, 0))).toEqual({
      runsDone: 0,
      runsTotal: 0,
      donePct: 0,
    });
  });
});
