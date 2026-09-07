// Refract — ruleset/r7-lens-unvisited: a lens left unvisited holds the beam
// incomplete.
//
// specs/beams.md R7: a beam is complete only when "every lens of that channel
// carries exactly two of its segments", and "no lens of a channel present is
// left unvisited". On the private board below the straight route
// T(0,0)-t(1,0)-T(2,0) runs between both emitters with exactly one segment
// meeting each — R6 holds — but leaves the lens t(1,1) unvisited, so the beam
// reports complete false. The untouched 3-charge crystal keeps the board
// unsolved and the reading on `playing`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  toCells,
  traceCells,
  type Harness,
} from "../harness";

/**
 * Private fixture — two routes between the emitters. The straight route
 * T(0,0)-t(1,0)-T(2,0) misses the lens t(1,1); the detour
 * T(0,0)-t(1,1)-t(1,0)-T(2,0) threads both lenses with exactly two segments
 * each. The crystal at (0,2) is never crossed, so its charges stay unspent and
 * the board stays unsolved either way.
 */
const TWO_ROUTES = `
TtT
.t.
3..
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("the route short one lens reports complete false", async () => {
  await resetTo(h);
  await loadBoard(h, TWO_ROUTES);

  traceCells(
    h,
    toCells([
      [0, 0],
      [1, 0],
      [2, 0],
    ]),
  );
  const snap = h.snapshot();
  assertEqual(
    snap.beams.triangle?.complete,
    false,
    "the route short one lens reports complete false",
  );
  assertEqual(snap.solved, false, "an incomplete beam solves nothing");
  assertEqual(snap.screen, "playing", "play continues");

  // Evidence: the route short one lens, reporting incomplete.
  await h.advance(1);
  captureStill(h, "incomplete");
});
