// ruleset/r6-r7-complete — R6 Endpoints and R7 Coverage decide a channel's
// `complete`, and neither is ever used to refuse a move (specs/beams.md,
// Enforcement).
//
// THE POSE. A private two-channel board (notation per specs/board.md):
//
//   T.T
//   tt.
//   S.S
//
// The square channel is present and never drawn, so completing the triangle
// beam cannot solve the board and the reading stays on the playing screen.
//
//   SHORT ONE LENS: T(0,0) → t(1,1) → T(2,0) runs between both triangle
//   emitters with exactly one segment meeting each (R6 holds), but leaves the
//   lens at (0,1) unvisited — R7 fails, so `complete` is false. Every move of
//   the route lands, INCLUDING the closing move onto the far emitter: an
//   incomplete beam breaks no rule, which is the "never used to refuse"
//   half asserted move by move.
//
//   THE FULL ROUTE: after `clear`, T(0,0) → t(0,1) → t(1,1) → T(2,0) threads
//   every triangle lens with exactly two of its segments — `complete` true.
//
// `complete` is the snapshot's derived reading of R6 and R7
// (specs/instrumentation.md, Snapshot shape).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
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

it("reports complete for the beam threading every lens, false for the same route short one lens, and refuses neither", async () => {
  await loadBoard(h, TWO_LENSES);

  // The route short one lens. Every move must LAND: R6 and R7 describe
  // finished work and refuse nothing.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
  ]);
  const short = await h.snapshot();

  // The same channel, cleared and rethreaded through every lens.
  await h.debug.clear();
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
    { col: 2, row: 0 },
  ]);
  const full = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "complete");

  assertDeepEqual(
    short.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 2, row: 0 },
    ],
    "every move of the lens-short route lands: completion conditions never refuse",
  );
  assertEqual(
    short.beams.triangle?.complete,
    false,
    "the route short one lens reports complete false",
  );
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
