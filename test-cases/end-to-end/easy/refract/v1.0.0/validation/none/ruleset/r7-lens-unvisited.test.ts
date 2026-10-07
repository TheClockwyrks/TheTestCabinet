// ruleset/r7-lens-unvisited — the same route short one lens reports `complete`
// false: no lens of a channel present is left unvisited (specs/beams.md R7).
//
// THE POSE. A private two-channel board (notation per specs/board.md):
//
//   T.T
//   tt.
//   S.S
//
// T(0,0) → t(1,1) → T(2,0) runs between both triangle emitters with exactly
// one segment meeting each, so R6 holds, but it leaves the lens at (0,1)
// unvisited — R7 fails, so `complete` is false. The square channel is present
// and never drawn, so the reading stays on the playing screen.
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

it("reports complete false for the route that leaves a lens unvisited", async () => {
  await loadBoard(h, TWO_LENSES);

  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
  ]);
  const short = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "incomplete");

  assertEqual(
    short.beams.triangle?.complete,
    false,
    "the route short one lens reports complete false",
  );
  assertEqual(short.solved, false, "and an incomplete beam solves nothing");
});
