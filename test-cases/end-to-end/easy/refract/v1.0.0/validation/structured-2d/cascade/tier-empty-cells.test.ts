// Refract — cascade/tier-empty-cells: each tier leaves at most the empty cells its rung allows.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the cap on cells left empty off it. The generator is asked for five boards at every
// tier through `generateBoard` (specs/instrumentation.md), and each board is
// held, as it arrives, against the row of the tier it was asked for at.
// Whether the build's own `tier` field tracks the ladder is
// cascade/tier-ladder's point; here the subject is the boards. The still is
// the last tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { MAX_TIER, TIERS, type Board } from "../notation";

const PER_TIER = 5;

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
  assertLessThanOrEqual(
    board.cols * board.rows - board.nodes.length,
    row.emptyCells,
    `${context}: empty cells at tier ${tier}`,
  );
}

it("leaves at most the stated count of cells empty for the tier each board was generated at", async () => {
  await resetTo(h);
  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    assertRung(board, tier, `tier ${tier}, board ${round}`);
  });
});
