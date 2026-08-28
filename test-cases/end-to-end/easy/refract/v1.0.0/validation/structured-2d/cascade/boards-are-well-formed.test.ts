// Refract — cascade/boards-are-well-formed: every generated board fits the
// generator's stated contract.
//
// specs/modes/cascade.md "The generator": each emitted board fits within
// GRID_MAX_COLS x GRID_MAX_ROWS (7 x 6), carries the first n of CHANNELS with
// exactly two emitters for each channel present, and gives every crystal 1 to
// MAX_CHARGES (3) charges. The same twenty-board sweep boards-are-solvable
// drives is read here for shape: every arrived board is held against that
// table, and the board the sweep leaves the player on afterwards — a fresh
// tier-5 board — is checked too and kept as the picture.

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
import { assertGeneratedBoardWellFormed } from "./helpers";

const SEED = 1;
const BOARDS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards within the contract, across the whole sweep", async () => {
  const solved = await solveGenerated(h, BOARDS, SEED);
  for (let k = 0; k < solved.length; k += 1) {
    assertGeneratedBoardWellFormed(solved[k].board, `board ${k + 1}`);
  }

  // One more board past the sweep, rendered on playing: the picture, and one
  // more reading of the same contract.
  await tapAction(h, "confirm");
  const next = h.snapshot();
  assertEqual(next.screen, "playing", "NEXT BOARD lands on playing");
  // A generated board within the contract.
  captureStill(h, "board");
  assertGeneratedBoardWellFormed(
    boardFromSnapshot(next),
    `board ${BOARDS + 1}`,
  );
});
