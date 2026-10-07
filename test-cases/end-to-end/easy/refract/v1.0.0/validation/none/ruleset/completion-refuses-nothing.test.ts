// ruleset/completion-refuses-nothing — R6 and R7 describe finished work, not
// legal moves, and are never used to refuse one (specs/beams.md, Enforcement).
//
// THE POSE. A private two-channel board (notation per specs/board.md):
//
//   T.T
//   tt.
//   S.S
//
// T(0,0) → t(1,1) → T(2,0) ends on the far emitter while the lens at (0,1)
// stands unvisited, so the beam it draws can never be complete. Every move of
// it must still LAND, the closing move onto the second emitter included: a
// build that consults the completion conditions on a move refuses that closing
// move and fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";

/** Two triangle lenses and an undrawn square channel to keep the board unsolved. */
const TWO_LENSES = `
T.T
tt.
S.S
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the lens-short route whole, its closing move included", async () => {
  await loadBoard(h, TWO_LENSES);

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
  ]);
  const drawn = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "drawn");

  assertDeepEqual(
    drawn.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
    ],
    "every move of the lens-short route lands: completion conditions never refuse",
  );
});
