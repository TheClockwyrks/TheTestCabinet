// discharge/fry-leaves-no-node — a fried segment leaves nothing behind.
//
// specs/discharge.md: "A segment destroyed by a discharge leaves nothing behind:
// no node is laid on the tile it stood on." specs/nodes.md states the rule this
// is the exception to — "Every worm segment destroyed by a BOLT leaves a fresh
// node at charge `0` on the tile it died on" — so the two routes out of a segment
// differ in exactly this, and a build that runs every segment death through one
// path leaves inert nodes here and is named for it.
//
// THE TWO TILES START EMPTY OF NODES. `startPlaying` clears the field and the
// scenario lays exactly one node, the critical one the bolt strikes, well away
// from the worm. So a node standing on either segment tile afterwards can only
// have been laid by the fry.
//
// BOTH SEGMENTS ARE INSIDE THE REACH — Chebyshev `1` and `2` from the detonation
// — and the worm is posed as a target with its STEP faculty off, so it holds the
// two tiles the reading is about instead of winding out of them.
//
// THE FRY IS GUARDED. "No node stands where the segments stood" is trivially true
// of a board where the segments were never destroyed, so the two tiles are read
// as empty of SEGMENTS first, as the scenario's precondition. That the discharge
// destroys a segment in reach at all is `fries-segments-in-reach`'s requirement
// and is graded there; here it is only what makes this reading a reading.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../../src/constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  poseWorm,
  segmentAt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: clear of every edge and of the band. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/** The worm's head, at the far edge of the reach along the struck node's row. */
const HEAD_C = STRUCK_C + DISCHARGE_RADIUS;
const WORM_R = STRUCK_R;

/** Two segments, so the reading covers a head and a tail rather than one tile. */
const WORM_LENGTH = 2;

/**
 * The tiles the worm stands on, head first.
 *
 * `poseWorm` lays the body behind a right-heading head, so the pair is
 * `(HEAD_C, r)` and `(HEAD_C - 1, r)` — Chebyshev `2` and `1` from the
 * detonation, both inside `DISCHARGE_RADIUS`.
 */
const SEGMENT_TILES = Array.from({ length: WORM_LENGTH }, (_, i) => ({
  c: HEAD_C - i,
  r: WORM_R,
}));

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays no node on the tiles a discharge's fried segments stood on", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  const worm = poseWorm(h, HEAD_C, WORM_R, WORM_LENGTH);
  h.debug.setWormStepping(worm, false);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "empty");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  for (const tile of SEGMENT_TILES) {
    assertEqual(
      segmentAt(swept.snapshot, tile.c, tile.r),
      false,
      `whether a segment still stands on (${tile.c}, ${tile.r}), which is the ` +
        "scenario's precondition: a segment has to have been fried for what it " +
        "left behind to be read (graded by discharge.fries-segments-in-reach)",
    );
  }

  for (const tile of SEGMENT_TILES) {
    assertNull(
      chargeAt(swept.snapshot, tile.c, tile.r),
      `the node on (${tile.c}, ${tile.r}), where a fried segment stood: a ` +
        "segment destroyed by a discharge leaves nothing behind, unlike one " +
        "destroyed by a bolt",
    );
  }
});
