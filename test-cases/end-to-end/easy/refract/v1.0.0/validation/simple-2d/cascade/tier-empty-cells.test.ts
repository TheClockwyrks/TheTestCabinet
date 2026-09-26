// Refract — cascade/tier-empty-cells: each tier leaves at most the empty cells its rung allows.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the cap on cells left empty off it. The generator is asked for five boards at every
// tier through `generateBoard` (specs/instrumentation.md), and each board is
// held, as it arrives, against the row of the tier it was asked for at.
// Whether the build's own `tier` field tracks the ladder is
// cascade/tier-ladder's point; here the subject is the boards. The oracle's
// TIERS table is the ladder as the spec states it, one entry per tier. The
// still is the last tier-5 board, the fullest row.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { MAX_TIER, TIERS } from "../notation";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves at most the stated count of cells empty for the tier each board was generated at", async () => {
  await resetTo(h);

  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    const spec = TIERS[tier - 1];
    const context = `tier ${tier}, board ${round}`;
    assertBetween(
      board.cols * board.rows - board.nodes.length,
      0,
      spec.emptyCells,
      `${context}: cells left empty within the tier's stated cap`,
    );
  });
});
