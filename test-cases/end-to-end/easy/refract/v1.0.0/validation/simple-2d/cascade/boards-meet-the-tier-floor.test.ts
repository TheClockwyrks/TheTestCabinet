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
// A BOARD THE ORACLE CANNOT MEASURE IS NOT JUDGED. The enumeration carries an
// expansion budget (DIFFICULTY_MAX_EXPANSIONS, a generous runaway stop) so a
// pathological board cannot hang the suite. When that budget runs out the
// oracle is admitting it could not read the five measures — a fact about this
// module, never a verdict on the build — so the board is set aside rather than
// failed. Reaching the SOLUTIONS cap is the opposite: that is a measurement,
// and a board over its tier's stated bound fails on the honest count. So the
// item can never pass by setting everything aside, the sweep must still measure
// at least twenty of its twenty-five boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, fail } from "../assert";
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

  let unmeasured = 0;
  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "board");
      const tier = tierForSolvedCount(snapshot.solvedCount);
      const board = oracleBoard(snapshot);
      const { measured, ok } = measuresUpToTier(board, tier);
      if (measured === null || measured.budget) {
        unmeasured += 1;
        return;
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

  // The verdict is never vacuous: enough of the sweep was really measured.
  assertLessThan(
    unmeasured,
    6,
    "at least twenty of the sweep's twenty-five boards measured inside the " +
      "oracle's expansion budget",
  );
});
