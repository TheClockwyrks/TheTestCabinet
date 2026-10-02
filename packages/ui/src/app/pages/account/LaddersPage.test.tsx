import { describe, expect, it } from "vitest";
import type {
  LadderClimber,
  LadderProgress,
} from "@clockwyrks/run-record/ladders";
import { ladderSummary, ladderSummaryLine } from "./LaddersPage";

function climber(over: Partial<LadderClimber> = {}): LadderClimber {
  return {
    key: "claude|opus",
    harness: "claude",
    model: "opus",
    priority: 0,
    focused: false,
    paused: false,
    status: "running",
    outcomes: [],
    ...over,
  } as LadderClimber;
}

// A climber standing on rung `position` has passed exactly the rungs below it; one
// with no current rung has completed and passed them all.
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
      supported: true,
    })),
    climbers,
    climbersRunning: climbers.filter((c) => c.status === "running").length,
    climbersCompleted: climbers.filter((c) => c.status === "completed").length,
    climbersFailed: climbers.filter((c) => c.status === "failed").length,
    climbersBlocked: climbers.filter((c) => c.status === "blocked").length,
    climbersPaused: climbers.filter((c) => c.status === "paused").length,
    runsUnreviewed: 2,
    runsInFlight: 0,
    bufferTarget: { kind: "bounded", runs: 10 },
  };
}

// A card's bar measures rungs passed across every climber, not climbers finished: a
// board where four of five models failed halfway is most of the way through the work,
// and "0 completed" would describe it as if nothing had happened.
describe("ladderSummary", () => {
  it("counts the rungs below each climber as cleared", () => {
    const summary = ladderSummary(progress([at(2), at(1)]));
    expect(summary.rungsCleared).toBe(3);
    expect(summary.rungsTotal).toBe(8);
    expect(summary.donePct).toBeCloseTo(37.5);
  });

  it("credits a completed climber with the whole climb", () => {
    const summary = ladderSummary(
      progress([climber({ status: "completed" }), at(0)]),
    );
    expect(summary.rungsCleared).toBe(4);
    expect(summary.completed).toBe(1);
    expect(summary.running).toBe(1);
  });

  it("reports failed climbers, which is the answer a ladder produces", () => {
    const summary = ladderSummary(
      progress([at(1, { status: "failed" }), at(3)]),
    );
    expect(summary.failed).toBe(1);
    expect(summary.unreviewed).toBe(2);
  });

  it("reports blocked climbers, which nothing will move until someone fixes them", () => {
    const summary = ladderSummary(
      progress([
        at(1, {
          status: "blocked",
          blocked: { kind: "unsupportedRung", rungId: "r1" },
        }),
        at(3),
      ]),
    );
    expect(summary.blocked).toBe(1);
  });

  it("does not divide by zero on a ladder nobody is climbing", () => {
    expect(ladderSummary(progress([])).donePct).toBe(0);
  });
});

describe("ladderSummaryLine", () => {
  it("says Climbers, Running, Completed, and Failed in plain words", () => {
    const line = ladderSummaryLine(
      ladderSummary(
        progress([
          at(1),
          at(2, { status: "failed" }),
          climber({ status: "completed" }),
        ]),
      ),
    );
    expect(line).toBe("3 climbers · 1 running · 1 completed · 1 failed");
    expect(line).not.toMatch(/walled|topped out|climbs automatically/i);
  });

  it("adds Blocked and Paused last, and only while a climber is in that state", () => {
    const line = ladderSummaryLine(
      ladderSummary(
        progress([
          at(1, { status: "blocked", blocked: { kind: "unrated", runs: 1 } }),
          at(0, { status: "paused", paused: true }),
        ]),
      ),
    );
    expect(line).toBe(
      "2 climbers · 0 running · 0 completed · 0 failed · 1 blocked · 1 paused",
    );
  });
});
