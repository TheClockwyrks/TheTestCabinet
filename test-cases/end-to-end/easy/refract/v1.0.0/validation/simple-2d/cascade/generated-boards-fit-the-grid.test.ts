// Refract — cascade/generated-boards-fit-the-grid: every generated board fits the grid.
//
// specs/modes/cascade.md "The generator": each emitted board fits within GRID_MAX_COLS x GRID_MAX_ROWS (7 x 6).
// What the TIER narrows that range to is cascade/tier-grid-range's point; here
// the subject is the generator's outer bound. The sweep is the same
// twenty-five-board walk the solvability check makes — each board really solved
// to reach the next — and each board is held against that row of the contract
// as it arrives. The still is the first MAX_TIER board, the fullest shape the
// ladder emits.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  oracleBoard,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";
import { assertFitsGrid, sweepGenerated } from "./sweep";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("emits only boards inside the grid bounds, across twenty-five boards", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  await sweepGenerated(h, 25, {
    onBoard: (snapshot, round) => {
      if (round === 21) captureStill(h, "board");
      assertFitsGrid(oracleBoard(snapshot), `generated board ${round}`);
    },
  });
});
