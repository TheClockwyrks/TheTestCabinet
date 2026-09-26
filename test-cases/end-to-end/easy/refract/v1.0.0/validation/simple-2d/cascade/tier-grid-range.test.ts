// Refract — cascade/tier-grid-range: each tier emits grids inside its stated range.
//
// specs/modes/cascade.md "The tier ladder" gives one row per tier; this point
// reads the grid size range the generator draws from off it. The generator is asked for five boards at every
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

it("draws every board's grid size from the stated range of the tier it was generated at", async () => {
  await resetTo(h);

  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    const spec = TIERS[tier - 1];
    const context = `tier ${tier}, board ${round}`;
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
  });
});
