// Refract — cascade/generated-boards-fit-the-grid: every generated board fits the grid.
//
// specs/modes/cascade.md "The generator": each emitted board fits within
// GRID_MAX_COLS x GRID_MAX_ROWS (7 x 6). What the TIER narrows that range to
// is cascade/tier-grid-range's point; here the subject is the generator's
// outer bound. The generator is asked for five boards at every tier through
// `generateBoard` (specs/instrumentation.md), and each board is held against
// that row of the contract as it arrives. The still is the last MAX_TIER
// board, the fullest shape the ladder emits.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  generateAtTiers,
  resetTo,
  type Harness,
} from "../harness";
import { MAX_TIER } from "../notation";
import { assertFitsGrid } from "./sweep";

const PER_TIER = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards inside the grid bounds, five at every tier", async () => {
  await resetTo(h);

  await generateAtTiers(h, PER_TIER, ({ tier, round, board }) => {
    if (tier === MAX_TIER && round === PER_TIER) captureStill(h, "board");
    assertFitsGrid(board, `tier ${tier}, board ${round}`);
  });
});
