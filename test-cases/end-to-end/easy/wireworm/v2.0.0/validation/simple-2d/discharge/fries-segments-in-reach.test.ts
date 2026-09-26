// discharge/fries-segments-in-reach — a discharge destroys the segments in reach.
//
// specs/discharge.md: "Every worm segment whose tile lies within
// `DISCHARGE_RADIUS` (`2`) tiles of the tile of any node the discharge detonated,
// measured the same Chebyshev way, is destroyed."
//
// THE SEGMENT SITS AT EXACTLY THE REACH, `DISCHARGE_RADIUS` tiles along the row
// from the node the bolt strikes. That is the inside edge of the boundary;
// `spares-segments-beyond-reach` is the outside one, and the two are separate
// points because a build that fries the whole board and a build that fries
// nothing would score the same on one paired point.
//
// THE WORM IS POSED AS A TARGET AND NOTHING ELSE. It is one segment long, so it
// has no body to follow, and its STEP faculty is switched off, so it cannot wind
// out of the blast while the bolt is in the air. Both are isolation, not
// convenience: whether the worm steps at all is the `worm` category's
// requirement, and a check about what a discharge reaches must not be able to
// fail because a worm moved first.
//
// THE WORM IS NOT IN THE BOLT'S COLUMN. specs/cursor.md resolves a bolt against
// the FIRST thing in its path and a segment beats a node, so a segment posed
// above the bolt would be struck instead of the node and no discharge would fire
// at all.
//
// WHAT THIS DOES NOT DECIDE. That the fried tile is left EMPTY rather than
// carrying a fresh node is `fry-leaves-no-node`'s requirement, and what a cut
// through a longer worm leaves behind is `fry-splits`'s; this point reads whether
// the segment is still on its tile.

import { afterEach, beforeEach, it } from "vitest";
import {
  BOARD_H,
  BOLT_SPEED,
  CHARGE_MAX,
  DISCHARGE_RADIUS,
} from "../constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
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

/** The segment's tile, exactly `DISCHARGE_RADIUS` along the row from the blast. */
const SEGMENT_C = STRUCK_C + DISCHARGE_RADIUS;
const SEGMENT_R = STRUCK_R;

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

it("destroys a worm segment two tiles from the detonation", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  const worm = poseWorm(h, SEGMENT_C, SEGMENT_R, 1);
  h.debug.setWormStepping(worm, false);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "fried");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertEqual(
    segmentAt(swept.snapshot, SEGMENT_C, SEGMENT_R),
    false,
    `whether any worm segment still stands on (${SEGMENT_C}, ${SEGMENT_R}), ` +
      `Chebyshev ${DISCHARGE_RADIUS} from the detonated node`,
  );
});
