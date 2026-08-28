// Refract — cascade/boards-meet-the-tier-floor: every generated board clears
// its tier's difficulty floor.
//
// specs/modes/cascade.md "The difficulty floor": each emitted board, measured
// by the five figures the spec defines — routes per channel, solutions,
// determined share, branching factor, shared crystals — lands within the
// bounds "The floor, by tier" states for the tier it was generated at. The
// sweep really solves twenty-five consecutive boards from a fixed seed —
// five per rung, so every tier's floor is exercised — and re-measures each
// board, as it arrives, with the oracle's own enumeration over the notation
// read off the snapshot; the tier a board is held to comes from the ladder
// formula over the solves that preceded it, not from the build's readout.
// The still is the first MAX_TIER board, the tier with the tallest floor.
//
// Documented residual risk (shared with boards-are-solvable): the oracle's
// enumeration is bounded — a solutions cap one past the tier's stated bound,
// and DIFFICULTY_MAX_EXPANSIONS as a generous runaway stop — so a board the
// budget abandons is reported as unmeasured and FAILS rather than passing by
// default. Every board within the tier ladder's stated shapes measures in
// well under the budget in practice.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { measuresUpToTier } from "../metrics";
import { tierForSolvedCount } from "../notation";
import { sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards meeting their tier's difficulty floor, across twenty-five boards", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "board");
      const tier = tierForSolvedCount(snapshot.solvedCount);
      const board = oracleBoard(snapshot);
      const { measured, ok } = measuresUpToTier(board, tier);
      if (measured === null || measured.capped) {
        return fail(
          `a measurable board ${round} (the oracle's enumeration budget ` +
            "was spent before the five measures settled, so the board is " +
            "unmeasured — a failure, not a pass; specs/modes/cascade.md " +
            '"The difficulty floor")',
          board,
        );
      }
      if (!ok) {
        fail(
          `board ${round}, generated at tier ${tier}, within the floor ` +
            `"The floor, by tier" states for that tier ` +
            "(specs/modes/cascade.md: routes per channel, solutions, " +
            "determined share, branching factor, and shared crystals all " +
            "within the tier's stated bounds)",
          measured,
        );
      }
    },
  });
});
