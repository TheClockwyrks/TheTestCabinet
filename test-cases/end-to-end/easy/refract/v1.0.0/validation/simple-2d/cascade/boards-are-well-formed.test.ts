// Refract — cascade/boards-are-well-formed: every generated board is well
// formed.
//
// specs/modes/cascade.md "The generator": each emitted board fits within
// GRID_MAX_COLS x GRID_MAX_ROWS (7 x 6), carries the first n of CHANNELS with
// exactly two emitters for each channel present, and gives every crystal 1 to
// MAX_CHARGES (3) charges. The sweep is the same twenty-five-board walk the
// solvability check makes — each board really solved to reach the next — and
// each board is held against the contract as it arrives. The still is the
// first MAX_TIER board, the fullest shape the ladder emits.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { assertWellFormed, sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards within the generator's contract, across twenty-five boards", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "board");
      assertWellFormed(oracleBoard(snapshot), `generated board ${round}`);
    },
  });
});
