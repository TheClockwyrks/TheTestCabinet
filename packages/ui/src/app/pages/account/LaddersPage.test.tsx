import { describe, expect, it } from "vitest";
import type {
  LadderClimber,
  LadderProgress,
} from "@test-cabinet/run-record/ladders";
import { ladderSummary } from "./LaddersPage";

function climber(over: Partial<LadderClimber> = {}): LadderClimber {
  return {
    key: "claude|opus",
    harness: "claude",
    model: "opus",
    priority: 0,
    focused: false,
    held: false,
    status: "climbing",
    outcomes: [],
    ...over,
  } as LadderClimber;
}

// A climber standing on rung `position` has cleared exactly the rungs below it; one
// with no current rung has topped out and cleared them all.
function at(
  position: number,
  over: Partial<LadderClimber> = {},
): LadderClimber {
  return climber({
    currentRung: { position } as LadderClimber["currentRung"],
    ...over,
  });
}

function progress(climbers: LadderClimber[]): LadderProgress {
  return {
    ladderId: "l1",
    outerAxis: "rung",
    rungs: [0, 1, 2, 3].map((position) => ({
      id: `r${position}`,
      position,
      slug: `case-${position}`,
      version: "v1.0.0",
      variant: "base",
      latestVersion: "v1.0.0",
      stale: false,
    })),
    climbers,
    climbersToppedOut: climbers.filter((c) => c.status === "toppedOut").length,
    climbersWalled: climbers.filter((c) => c.status === "walled").length,
    runsMissing: 0,
    runsUnreviewed: 2,
    runsOutstanding: 0,
    bufferTarget: 10,
  };
}

// A card's bar measures rungs cleared across every climber, not climbers finished: a
// board where four of five models are walled halfway is most of the way through the
// work, and "0 topped out" would describe it as if nothing had happened.
describe("ladderSummary", () => {
  it("counts the rungs below each climber as cleared", () => {
    const summary = ladderSummary(progress([at(2), at(1)]));
    expect(summary.rungsCleared).toBe(3);
    expect(summary.rungsTotal).toBe(8);
    expect(summary.donePct).toBeCloseTo(37.5);
  });

  it("credits a topped-out climber with the whole climb", () => {
    const summary = ladderSummary(
      progress([climber({ status: "toppedOut" }), at(0)]),
    );
    expect(summary.rungsCleared).toBe(4);
    expect(summary.toppedOut).toBe(1);
  });

  it("reports walled climbers, which is the answer a ladder produces", () => {
    const summary = ladderSummary(
      progress([at(1, { status: "walled" }), at(3)]),
    );
    expect(summary.walled).toBe(1);
    expect(summary.unreviewed).toBe(2);
  });

  it("does not divide by zero on a ladder nobody is climbing", () => {
    expect(ladderSummary(progress([])).donePct).toBe(0);
  });
});
