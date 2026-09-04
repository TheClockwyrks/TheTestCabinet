// Refract — cascade/generated-boards-fit-the-grid: every generated board fits the grid.
//
// specs/modes/cascade.md "The generator": each emitted board is a grid within GRID_MAX_COLS x
// GRID_MAX_ROWS (7 x 6). What the TIER narrows that range to is
// cascade/tier-grid-range's point; here the subject is the generator's outer
// bound.
//
// The same twenty-five-board sweep boards-are-solvable drives is read here:
// every arrived board is held against that row of the contract, and the board
// the sweep leaves the player on afterwards — a fresh tier-5 board — is checked
// too and kept as the picture.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { assertFitsGrid } from "./helpers";

const SEED = 1;
const BOARDS = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards inside the grid bounds, across the whole sweep", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    assertFitsGrid(solved[k].board, `board ${k + 1}`);
  }

  // One more board past the sweep, rendered on playing: the picture, and one
  // more reading of the same clause.
  await tapAction(h, "confirm");
  const next = h.snapshot();
  assertEqual(next.screen, "playing", "NEXT BOARD lands on playing");
  captureStill(h, "board");
  assertFitsGrid(boardFromSnapshot(next), `board ${BOARDS + 1}`);
});
