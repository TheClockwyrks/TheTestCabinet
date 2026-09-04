// cascade/generated-boards-fit-the-grid — every generated board fits the grid.
//
// specs/modes/cascade.md "The generator": each emitted board is a grid within
// GRID_MAX_COLS (7) x GRID_MAX_ROWS (6). The sweep reads each board off the
// snapshot as it arrives and holds its cols and rows to that ceiling — solving
// as it goes (the only way the sequence advances), with a different seed from
// the solvability sweep so the two points read different draws of the
// generator. What the TIER narrows the range to is cascade/tier-grid-range's
// point; here the subject is the generator's outer bound.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { GRID_MAX_COLS, GRID_MAX_ROWS } from "../notation";
import {
  captureStill,
  createHarness,
  solveGenerated,
  type Harness,
} from "../harness";

const SWEEP = 25;
const SEED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("every board of the sweep fits within GRID_MAX_COLS x GRID_MAX_ROWS", async () => {
  const sweep = await solveGenerated(
    h,
    SWEEP,
    SEED,
    async (_snapshot, index) => {
      if (index === SWEEP - 1) await captureStill(h, "board");
    },
  );

  for (const [index, board] of sweep.boards.entries()) {
    const at = `board ${index + 1}`;
    assertBetween(board.cols, 1, GRID_MAX_COLS, `${at}: cols`);
    assertBetween(board.rows, 1, GRID_MAX_ROWS, `${at}: rows`);
  }
});
