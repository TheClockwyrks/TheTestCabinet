// cascade/generated-boards-fit-the-grid — every generated board fits the grid.
//
// specs/modes/cascade.md "The generator": each emitted board is a grid within
// GRID_MAX_COLS (7) x GRID_MAX_ROWS (6). The generator is asked for five boards
// at every tier through `generateBoard` (specs/instrumentation.md), and each is
// read off the snapshot as it arrives and held to that ceiling. What the TIER
// narrows the range to is cascade/tier-grid-range's point; here the subject is
// the generator's outer bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { GRID_MAX_COLS, GRID_MAX_ROWS, MAX_TIER } from "../notation";
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

it("every board generated at every tier fits within GRID_MAX_COLS x GRID_MAX_ROWS", async () => {
  const generated = await generateAtTiers(
    h,
    PER_TIER,
    async ({ tier, round }) => {
      if (tier === MAX_TIER && round === PER_TIER)
        await captureStill(h, "board");
    },
  );

  for (const { tier, round, board } of generated) {
    const at = `tier ${tier}, board ${round}`;
    assertBetween(board.cols, 1, GRID_MAX_COLS, `${at}: cols`);
    assertBetween(board.rows, 1, GRID_MAX_ROWS, `${at}: rows`);
  }
});
