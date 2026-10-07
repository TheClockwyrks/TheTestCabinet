// cascade/tier-grid-range — each tier emits grids inside its stated range.
//
// specs/modes/cascade.md's ladder table, held verbatim in notation.ts's TIERS:
// per tier, the grid's cols x rows range, each drawn independently. The
// generator is asked for five boards at every tier through `generateBoard`
// (specs/instrumentation.md), and each board is held to the row of the tier it
// was asked for at, since "the generator draws each board's grid size from its
// tier's stated range". Whether the tier FIELD tracks the ladder is
// tier-ladder's point; here the subject is the boards.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { MAX_TIER, TIERS } from "../notation";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  type Harness,
} from "../harness";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("each board's cols and rows fall inside the stated range of the tier it was generated at", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round }) => {
      if (tier === MAX_TIER && round === PER_TIER)
        await captureStill(h, "board");
    },
  );

  for (const { tier, round, board } of generated) {
    const row = TIERS[tier - 1];
    const at = `tier ${tier}, board ${round}`;

    assertBetween(board.cols, row.cols[0], row.cols[1], `${at}: cols`);
    assertBetween(board.rows, row.rows[0], row.rows[1], `${at}: rows`);
  }
});
