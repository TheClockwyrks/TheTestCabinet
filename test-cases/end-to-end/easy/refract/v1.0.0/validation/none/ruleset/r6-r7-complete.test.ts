// ruleset/r6-r7-complete — a beam running between its channel's two emitters,
// one segment meeting each, and threading every lens of that channel with
// exactly two of its segments, reports `complete` true (specs/beams.md R6, R7).
//
// THE POSE. A private two-channel board (notation per specs/board.md):
//
//   T.T
//   tt.
//   S.S
//
// The square channel is present and never drawn, so completing the triangle
// beam cannot solve the board and the reading stays on the playing screen.
// T(0,0) → t(0,1) → t(1,1) → T(2,0) meets each emitter with exactly one
// segment and threads each triangle lens with exactly two.
//
// `complete` is the snapshot's derived reading of R6 and R7
// (specs/instrumentation.md, Snapshot shape).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("reports complete for the beam between both emitters threading every lens", async () => {
  await loadBoard(h, TWO_LENSES);

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
  ]);
  const full = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "complete");

  assertEqual(
    full.beams.triangle?.complete,
    true,
    "the beam between both emitters threading every lens twice reports complete true",
  );
  assertEqual(
    full.solved,
    false,
    "one complete beam does not solve a board with an undrawn channel",
  );
});
