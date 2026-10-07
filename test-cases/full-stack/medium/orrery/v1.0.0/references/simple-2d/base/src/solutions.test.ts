// Orrery — every shipped reference solution, proved against its challenge
// (specs/modes/campaign.md, specs/modes/extras.md).
//
// The requirement both mode files state is the same one: every challenge ships
// a reference solution, in the solution format, that is legal, places every
// rise and set, and whose run COMPLETES without faulting inside
// `CAMPAIGN_REFERENCE_CYCLES` (600) cycles. A solution that stops completing is
// the worst defect this build can carry, so each of the twenty-three gets its
// own case here, run end to end through the debug surface exactly as a
// scenario driven from code would run it.
//
// The metrics each solution achieves are asserted rather than merely reported.
// They are not required figures — `cost`, `cycles`, and `area` are whatever the
// machine happens to spend — but pinning them turns any silent change in the
// simulation, the sigil order, or a tape into a red test naming the challenge
// it broke.

import { describe, expect, it } from "vitest";

import { challengesOf } from "./challenges";
import {
  CAMPAIGN_FINALE_PARTS,
  CAMPAIGN_MAX,
  CAMPAIGN_MIN,
  CAMPAIGN_OPENER_PARTS,
  CAMPAIGN_REFERENCE_CYCLES,
  EXTRA_COUNT,
  PARTS,
} from "./constants";
import { createStateOps } from "./debug";
import { parseSolution } from "./formats";
import { Session } from "./session";
import { stepOneCycle } from "./sim";
import { SOLUTION_DOCUMENTS } from "./solutions";
import type { Metrics, Mode, PartKind, Solution, W } from "./types";

/** The reference solution for one challenge, parsed. */
function solutionOf(mode: Mode, index: number): Solution {
  return parseSolution(SOLUTION_DOCUMENTS[mode][index]);
}

/**
 * Open a mode's challenge, load its reference solution through the surface,
 * start the run, and step whole cycles until it stops. The bound is the one
 * specs/modes/campaign.md fixes, and exceeding it fails rather than looping.
 */
function completeRun(mode: Mode, index: number): W<Metrics> {
  const game = new Session();
  const api = createStateOps(game);
  api.openChallenge(mode, index);
  api.loadSolution(api.referenceSolution(mode, index));
  api.startRun();
  for (let cycle = 0; cycle < CAMPAIGN_REFERENCE_CYCLES; cycle += 1) {
    const sim = game.state.sim;
    if (sim === null) throw new Error("the run ended");
    if (sim.status !== "running" && sim.status !== "paused") break;
    stepOneCycle(game);
  }
  const sim = game.state.sim;
  if (sim === null) throw new Error("the run ended");
  if (sim.status !== "complete" || sim.metrics === null) {
    throw new Error(
      `${mode} ${index + 1} is ${sim.status} at cycle ${sim.cycle}` +
        (sim.fault === null ? "" : `, fault ${sim.fault.kind}`),
    );
  }
  return sim.metrics;
}

/** What each reference solution achieves: the three metrics of its run. */
const RECORDS: Record<Mode, W<Metrics>[]> = {
  campaign: [
    { cost: 20, cycles: 45, area: 5 }, // 1  Meridian
    { cost: 30, cycles: 57, area: 5 }, // 2  Emberfall
    { cost: 50, cycles: 95, area: 8 }, // 3  The Bound Pair
    { cost: 70, cycles: 57, area: 12 }, // 4  The Zodiac Wheel
    { cost: 90, cycles: 89, area: 10 }, // 5  The Long Reach
    { cost: 75, cycles: 111, area: 12 }, // 6  The Carriage
    { cost: 70, cycles: 81, area: 9 }, // 7  Quicksilver Ladder
    { cost: 100, cycles: 117, area: 15 }, // 8  The Second Rung
    { cost: 90, cycles: 75, area: 9 }, // 9  Umbra and Lumen
    { cost: 70, cycles: 61, area: 15 }, // 10 Chaff and Grain
    { cost: 170, cycles: 215, area: 20 }, // 11 Threefold Cord
    { cost: 110, cycles: 135, area: 19 }, // 12 Aether Undone
    { cost: 200, cycles: 334, area: 20 }, // 13 The Great Work
  ],
  extras: [
    { cost: 20, cycles: 45, area: 5 }, // 1  First Light
    { cost: 50, cycles: 95, area: 8 }, // 2  Twin Moons
    { cost: 60, cycles: 131, area: 8 }, // 3  Waning Crescent
    { cost: 140, cycles: 113, area: 20 }, // 4  Mirrorwright
    { cost: 40, cycles: 95, area: 7 }, // 5  Ascendant
    { cost: 60, cycles: 95, area: 8 }, // 6  Great Conjunction
    { cost: 120, cycles: 137, area: 12 }, // 7  Syzygy
    { cost: 120, cycles: 41, area: 14 }, // 8  Aetherfall
    { cost: 60, cycles: 95, area: 8 }, // 9  Trine
    { cost: 50, cycles: 47, area: 8 }, // 10 Procession
  ],
};

describe.each(["campaign", "extras"] as const)(
  "%s reference solutions complete (specs/modes/campaign.md)",
  (mode) => {
    const list = challengesOf(mode);
    list.forEach((challenge, index) => {
      it(`${index + 1}. ${challenge.name}`, () => {
        const metrics = completeRun(mode, index);
        expect(metrics.cycles).toBeLessThanOrEqual(CAMPAIGN_REFERENCE_CYCLES);
        expect(metrics).toEqual(RECORDS[mode][index]);
      });
    });
  },
);

describe("every reference solution is legal for its challenge", () => {
  for (const mode of ["campaign", "extras"] as const) {
    const list = challengesOf(mode);
    list.forEach((challenge, index) => {
      it(`${mode} ${index + 1} places every rise and set, of permitted kinds`, () => {
        const { parts } = solutionOf(mode, index);
        const rises = parts
          .filter((part) => part.kind === "rise")
          .map((part) => part.index);
        const sets = parts
          .filter((part) => part.kind === "set")
          .map((part) => part.index);
        expect([...rises].sort()).toEqual(challenge.reagents.map((_, i) => i));
        expect([...sets].sort()).toEqual(challenge.products.map((_, i) => i));
        for (const part of parts) {
          if (part.kind === "rise" || part.kind === "set") continue;
          expect(challenge.permitted).toContain(part.kind);
        }
      });
    });
  }
});

/** How many parts each mode's reference solutions place, in order. */
function partCounts(mode: Mode): number[] {
  return SOLUTION_DOCUMENTS[mode].map(
    (_document, index) => solutionOf(mode, index).parts.length,
  );
}

/** The longest tape each mode's reference solutions carry, in order. */
function longestTapes(mode: Mode): number[] {
  return SOLUTION_DOCUMENTS[mode].map((_document, index) =>
    solutionOf(mode, index).parts.reduce(
      (longest, part) => Math.max(longest, part.tape?.length ?? 0),
      0,
    ),
  );
}

describe("every reference solution round-trips through the surface", () => {
  for (const mode of ["campaign", "extras"] as const) {
    challengesOf(mode).forEach((challenge, index) => {
      it(`${mode} ${index + 1}. ${challenge.name}`, () => {
        const game = new Session();
        const api = createStateOps(game);
        api.openChallenge(mode, index);
        const reference = api.referenceSolution(mode, index);
        api.loadSolution(reference);
        // `readSolution` returns exactly what `loadSolution` would accept to
        // rebuild the machine (specs/instrumentation.md), so a reference that
        // survives the trip is written in the format the surface speaks.
        expect(api.readSolution()).toEqual(reference);
      });
    });
  }
});

describe("the course rises in difficulty (specs/modes/campaign.md)", () => {
  it("holds between CAMPAIGN_MIN and CAMPAIGN_MAX challenges, and ten Extras", () => {
    expect(challengesOf("campaign").length).toBeGreaterThanOrEqual(
      CAMPAIGN_MIN,
    );
    expect(challengesOf("campaign").length).toBeLessThanOrEqual(CAMPAIGN_MAX);
    expect(challengesOf("extras").length).toBe(EXTRA_COUNT);
  });

  it("carries a distinct name for every campaign challenge", () => {
    const names = challengesOf("campaign").map((challenge) => challenge.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("opens on at most CAMPAIGN_OPENER_PARTS parts and finishes on at least CAMPAIGN_FINALE_PARTS", () => {
    const counts = partCounts("campaign");
    expect(counts[0]).toBeLessThanOrEqual(CAMPAIGN_OPENER_PARTS);
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(
      CAMPAIGN_FINALE_PARTS,
    );
  });

  it("never places fewer parts than the solution two challenges before", () => {
    const counts = partCounts("campaign");
    for (let index = 2; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 2]);
    }
  });

  it("asks more of its last challenge than of any before it", () => {
    const counts = partCounts("campaign");
    const tapes = longestTapes("campaign");
    const last = counts.length - 1;
    expect(counts[last]).toBeGreaterThan(Math.max(...counts.slice(0, last)));
    expect(tapes[last]).toBeGreaterThan(Math.max(...tapes.slice(0, last)));
  });

  it("places every part kind of PARTS somewhere in the course", () => {
    const placed = new Set<PartKind>();
    for (let index = 0; index < challengesOf("campaign").length; index += 1) {
      for (const part of solutionOf("campaign", index).parts) {
        placed.add(part.kind);
      }
    }
    expect(PARTS.filter((kind) => !placed.has(kind))).toEqual([]);
  });
});
