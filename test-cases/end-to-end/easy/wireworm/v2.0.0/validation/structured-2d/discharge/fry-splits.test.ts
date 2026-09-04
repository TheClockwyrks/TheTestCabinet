// discharge/fry-splits — a discharge through a worm's middle leaves two worms.
//
// specs/worm.md, on cutting the worm: "Whenever segments are removed from a worm,
// whatever removed them, the segments that survive fall into runs of consecutive
// segments, counted from the head end. Each run becomes a worm of its own", and
// "A bolt into a middle segment leaves two worms, the head-side run and the
// tail-side run." specs/discharge.md points the discharge at the same rule: "When
// a discharge removes segments from the middle of a worm, the surviving runs
// become worms by the rule specs/worm.md states."
//
// The board poses that cut and reads the roster. Thirteen segments lie along one
// row; the critical node stands one row below the middle of them, so the `5 x 5`
// block of its detonation covers the five middle segments and neither end. Five
// go, a run of four survives at each end, and the roster afterwards holds exactly
// two worms.
//
// The count is what separates the wrong models. A build that removes the whole
// worm the moment a discharge touches it reports `0`; a build that keeps the
// survivors as one worm — closing the gap, or dropping the far run — reports `1`;
// a build that makes a worm of each surviving SEGMENT reports `8`. Only the stated
// rule reports `2`.
//
// Which id each piece carries is discharge/fry-split-keeps-head-id, its own point.
//
// The worm's faculties are off. This point is about what the discharge leaves
// behind, so the worm holds its tiles rather than walking during the shot.

import { afterEach, beforeEach, it } from "vitest";
import { ARC_LIFE } from "../../src/constants";
import { assertLength, assertNull } from "../assert";
import {
  captureReplay,
  chargeAt,
  createHarness,
  poseWormPath,
  startPlaying,
  ticksFor,
  type Harness,
  type Tile,
  type WirewormSnapshot,
} from "../harness";
import { detonate } from "./detonation";

/** The row the worm lies along. */
const ROW = 10;

/** The columns its segments occupy, from the head end. */
const HEAD_COLUMN = 17;
const TAIL_COLUMN = 5;

/**
 * The worm, head first: thirteen segments along one row, which is well clear of
 * both the entry row and the player band.
 */
const SEGMENTS: Tile[] = Array.from(
  { length: HEAD_COLUMN - TAIL_COLUMN + 1 },
  (_unused, index) => ({ c: HEAD_COLUMN - index, r: ROW }),
);

/**
 * The critical node: one row below the worm, under its middle column. Every tile
 * of the worm is therefore at Chebyshev distance `max(|c - 11|, 1)` from it, so
 * the five segments on columns `9` through `13` lie within `DISCHARGE_RADIUS`
 * (`2`) and the four at each end lie at `3` or more.
 *
 * The worm is long enough, and the fried run far enough inside the reach, that
 * the cut still falls in its middle on a build whose radius is a tile out either
 * way: this point is about what the surviving runs become, and how far the fry
 * reaches is discharge/fries-segments-in-reach and its opposite number.
 */
const STRUCK = { c: 11, r: ROW + 1 };

/** The two runs the cut has to leave: one at the head end, one at the tail. */
const EXPECTED_WORMS = 2;

/**
 * Frames recorded after the chain resolves, so the clip runs on past the moment of
 * the cut and a reviewer sees the two pieces standing rather than the single frame
 * they appeared on. `ARC_LIFE` (`0.32` s) is the length of a discharge's own
 * flash, which is as long as there is anything left to watch.
 */
const SETTLE_TICKS = ticksFor(ARC_LIFE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the head-side and tail-side runs as two worms", async () => {
  startPlaying(h);
  const worm = poseWormPath(h, SEGMENTS);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);

  const after = await captureReplay(h, "split", async () => {
    await detonate(h, STRUCK.c, STRUCK.r);
    const resolved: WirewormSnapshot = h.snapshot();
    await h.advance(SETTLE_TICKS);
    return resolved;
  });

  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertLength(
    after.worms,
    EXPECTED_WORMS,
    "the worms on the board after the cut",
  );
});
