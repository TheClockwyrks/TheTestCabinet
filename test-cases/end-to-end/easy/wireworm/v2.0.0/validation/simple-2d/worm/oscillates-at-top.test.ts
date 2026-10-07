// worm/oscillates-at-top — blocked on the entry row while heading up, the worm
// flips its vertical heading back to down and drops a row.
//
// specs/worm.md, "Winding": on a blocked step "its vertical heading is checked. If
// the row at `r + dv` is off the board, which is a row outside `0` to `19`, the
// vertical heading flips first, so `dv` becomes `-dv`", and then "the head moves
// one row in its vertical heading, to `(c, r + dv)`". The section states the
// consequence outright: "a worm on the entry row (`0`) heading up flips to heading
// down and drops a row, so a worm oscillates across the lower board rather than
// leaving it."
//
// THE WORLD IS ONE HEAD ON THE ENTRY ROW. `startPlaying` leaves the board empty
// and the three world gates shut, and the scenario puts back one worm of a single
// segment, posed with its vertical heading UP — which is the state a worm reaches
// by oscillating off the floor, and which `setWormDescent` poses directly rather
// than driving the board to.
//
// THE BLOCK IS THE BOARD'S SIDE EDGE, AND THAT IS DELIBERATE. The rule needs a
// blocked step on row `0`, and any node or segment posed to block one would have
// to stand on row `0` — a second entity on the row a level's worm enters along.
// The edge adds nothing to the world. The edge rule itself is graded by
// `worm.blocked-by-edge`.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseWorm,
  segmentAt,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
} from "../harness";

/** The head: the entry row, on the last column, heading outward and up. */
const HEAD_C = COLS - 1;
const HEAD_R = 0;

/** How long the step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the vertical heading down and drops a row rather than leaving the board", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, HEAD_R, 1, 1, -1);

  const swept = await h.until((s) => !segmentAt(s, HEAD_C, HEAD_R), {
    maxFrames: STEP_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "top");

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  const worm = wormOf(swept.snapshot, id);
  assertEqual(
    worm.dv,
    1,
    "dv after the step blocked on the entry row, posed at -1",
  );
  assertDeepEqual(
    headOf(worm),
    { c: HEAD_C, r: HEAD_R + 1 },
    "the head one row down, holding its own column",
  );
});
