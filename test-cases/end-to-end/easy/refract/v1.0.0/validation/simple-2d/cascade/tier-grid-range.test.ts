// Refract — cascade/tier-grid-range: each tier emits grids inside its stated range.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the grid size range the generator draws from off it. The sweep really solves
// twenty-five boards and holds each board, as it arrives, against the row for
// the tier it was generated at — read as the SPEC'S OWN FORMULA over the
// arrival snapshot's solvedCount. Reading the build's own `tier` field instead
// would let a build that mis-reports the rung be judged against the rung it
// claims; whether that field tracks the ladder is cascade/tier-ladder's point,
// and here the subject is the boards. Twenty-five boards visit every rung: five
// at each of tiers 1..5. The oracle's TIERS table is the ladder as the spec
// states it, one entry per tier. The still is a tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, fail } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { TIERS, tierForSolvedCount } from "../notation";
import { sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws every board's grid size from its tier's stated range", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "board");
      const tier = tierForSolvedCount(snapshot.solvedCount);
      const spec = TIERS[tier - 1];
      if (spec === undefined) {
        return fail(
          `a tier 1..${TIERS.length} on the ladder (specs/modes/cascade.md)`,
          tier,
        );
      }
      const context = `board ${round}, generated at tier ${spec.tier}`;
      const board = oracleBoard(snapshot);
      assertBetween(
        board.cols,
        spec.cols[0],
        spec.cols[1],
        `${context}: cols within the tier's stated range`,
      );
      assertBetween(
        board.rows,
        spec.rows[0],
        spec.rows[1],
        `${context}: rows within the tier's stated range`,
      );
    },
  });
});
