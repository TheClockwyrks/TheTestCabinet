// worm/oscillates-at-floor — blocked on the floor row, the worm flips its vertical
// heading to up and rises a row instead of leaving the board.
//
// specs/worm.md, "Winding": on a blocked step "its vertical heading is checked. If
// the row at `r + dv` is off the board, which is a row outside `0` to `19`, the
// vertical heading flips first, so `dv` becomes `-dv`", and then "the head moves
// one row in its vertical heading, to `(c, r + dv)`". The section states the
// consequence outright: "A worm on the floor row (`19`) heading down therefore
// flips to heading up and rises a row ... A worm never leaves the board through an
// edge."
//
// THE WORLD IS ONE HEAD ON THE FLOOR ROW. `startPlaying` leaves the board empty
// and the three world gates shut — the cursor's contact test included, which
// matters here because row `19` is inside the player band the cursor sits in, and
// a life lost mid-scenario would sweep both rosters. The scenario puts back one
// worm of a single segment and nothing else.
//
// THE BLOCK IS THE BOARD'S SIDE EDGE, AND THAT IS DELIBERATE. The rule needs a
// blocked step on row `19`, and any node or segment posed to block one would have
// to stand on row `19` too — a second entity inside the band. The edge adds
// nothing to the world, so the board holds one segment. The edge rule itself is
// graded by `worm.blocked-by-edge`.

import { afterEach, beforeEach, it } from "vitest";
import { COLS, ROWS, WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  headOf,
  poseWorm,
  segmentAt,
  startPlaying,
  ticksFor,
  wormOf,
  type Harness,
} from "../harness";

/** The head: the floor row, on the last column, heading outward and down. */
const HEAD_C = COLS - 1;
const HEAD_R = ROWS - 1;

/** How long the step may take before the sweep gives up, in frames. */
const STEP_TIMEOUT = ticksFor(WORM_STEP_L1 * 4);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("flips the vertical heading up and rises a row rather than leaving the board", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, HEAD_R, 1, 1, 1);

  const swept = await captureReplay(h, "floor", async () => {
    const left = await h.until((s) => !segmentAt(s, HEAD_C, HEAD_R), {
      maxFrames: STEP_TIMEOUT,
      poll: 1,
    });
    // A settle, inside the bracket. What this point CLAIMS is that the worm
    // turns rather than leaving the board, and a recording that stopped on the
    // frame the head left its tile shows the leaving and not the turn. Two
    // further steps' worth of frames carry it visibly up the board. The reading
    // is taken above, before the settle, so no verdict moves.
    await h.advance(ticksFor(WORM_STEP_L1 * 2.5));
    return left;
  });

  assertEqual(
    swept.hit,
    true,
    `the head to leave tile (${HEAD_C}, ${HEAD_R}) within ${STEP_TIMEOUT} frames`,
  );
  const worm = wormOf(swept.snapshot, id);
  assertEqual(
    worm.dv,
    -1,
    "dv after the step blocked on the floor row, posed at +1",
  );
  // A build that dropped anyway would have taken the head off the board, and the
  // roster look-up above is what reports that.
  assertDeepEqual(
    headOf(worm),
    { c: HEAD_C, r: HEAD_R - 1 },
    "the head one row up, holding its own column",
  );
});
