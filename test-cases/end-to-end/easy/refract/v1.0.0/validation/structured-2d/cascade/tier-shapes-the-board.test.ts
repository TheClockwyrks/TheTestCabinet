// Refract — cascade/tier-shapes-the-board: each tier emits the boards its
// rung describes.
//
// specs/modes/cascade.md "The tier ladder": the generator draws each board's
// grid size from its tier's stated range, and the rung fixes the channel
// count, the crystals — their count and the charges each carries — and how
// many cells the board may leave empty. Across the twenty-five-board sweep,
// board k arrives after exactly k solves, so its rung is the formula's tier
// at k; the board is held against that rung's row of TIERS: cols and rows
// within the stated range, channel count equal to the row's, crystal count
// within the row's range, every crystal's charges within the row's range,
// and empty cells at most the row's cap.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import {
  channelsPresent,
  TIERS,
  tierForSolvedCount,
  type Board,
} from "../notation";

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
function assertShapedByTier(board: Board, tier: number, context: string): void {
  const row = TIERS[tier - 1];
  assertBetween(
    board.cols,
    row.cols[0],
    row.cols[1],
    `${context}: cols at tier ${tier}`,
  );
  assertBetween(
    board.rows,
    row.rows[0],
    row.rows[1],
    `${context}: rows at tier ${tier}`,
  );
  assertEqual(
    channelsPresent(board).length,
    row.channels,
    `${context}: channels at tier ${tier}`,
  );
  assertLessThanOrEqual(
    board.cols * board.rows - board.nodes.length,
    row.emptyCells,
    `${context}: empty cells at tier ${tier}`,
  );
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

it("emits every board within its tier's stated grid, channels, and crystals", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    assertShapedByTier(
      solved[k].board,
      tierForSolvedCount(k),
      `board ${k + 1}`,
    );
  }

  // A board shaped by its tier: the fresh top-tier board after the sweep.
  await tapAction(h, "confirm");
  assertEqual(h.snapshot().screen, "playing", "NEXT BOARD lands on playing");
  captureStill(h, "board");
});
