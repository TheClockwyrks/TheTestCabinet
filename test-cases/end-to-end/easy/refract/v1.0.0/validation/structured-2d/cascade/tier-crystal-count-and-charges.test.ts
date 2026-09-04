// Refract — cascade/tier-crystal-count-and-charges: each tier crowds its crystals as its rung states.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the crystal count and charge ranges off it. Across the twenty-five-board
// sweep, board k arrives after exactly k solves, so its rung is the formula's
// tier at k — read as the SPEC'S OWN FORMULA rather than off the build's `tier`
// field, which would let a build that mis-reports the rung be judged against
// the rung it claims; whether that field tracks the ladder is
// cascade/tier-ladder's point, and here the subject is the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { TIERS, tierForSolvedCount, type Board } from "../notation";

const SEED = 1;
const BOARDS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Hold one arrived board against its rung's row of the ladder. */
function assertRung(board: Board, tier: number, context: string): void {
  const row = TIERS[tier - 1];
  const crystals = board.nodes.filter((node) => node.kind === "crystal");
  assertBetween(
    crystals.length,
    row.crystals[0],
    row.crystals[1],
    `${context}: crystals at tier ${tier}`,
  );
  for (const crystal of crystals) {
    assertNotNull(
      crystal.charges,
      `${context}: a crystal at (${crystal.col}, ${crystal.row}) carries charges`,
    );
    assertBetween(
      crystal.charges as number,
      row.charges[0],
      row.charges[1],
      `${context}: charges at (${crystal.col}, ${crystal.row}) at tier ${tier}`,
    );
  }
}

it("gives every board its tier's crystal count and charge range", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    assertRung(solved[k].board, tierForSolvedCount(k), `board ${k + 1}`);
  }

  // The picture: the fresh top-tier board after the sweep.
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "NEXT BOARD lands on playing");
  captureStill(h, "board");
});
