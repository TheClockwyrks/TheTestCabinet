// worm/shot-middle-splits — a bolt into a middle segment leaves two worms.
//
// specs/worm.md, "Cutting the worm": "the segments that survive fall into runs of
// consecutive segments, counted from the head end. Each run becomes a worm of its
// own", and the section states this case outright: "A bolt into a middle segment
// leaves two worms, the head-side run and the tail-side run."
//
// THE FOURTH SEGMENT OF SEVEN, SO THE TWO RUNS ARE THE SAME LENGTH. Three
// segments stand on each side of the break, which makes the reading immune to
// being read from the wrong end: a build that cut at the mirror position would
// produce the same pair, so nothing here can pass by accident of orientation while
// the counts themselves are what the point is about.
//
// THE WORM IS POSED STILL. Its STEP faculty is off, which specs/instrumentation.md
// states leaves the rest of the board running, so nothing about the worm's own
// motion can carry the target segment out from under the bolt while it climbs.
//
// THE WORLD IS ONE WORM AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, so no node stands in the bolt's column to consume it
// on the way, and no foe or second worm exists.
//
// WHAT THIS DOES NOT DECIDE. Which piece keeps the worm's id is
// `worm.split-keeps-head-id`'s requirement and how the trailing piece then leads
// is `worm.split-new-head-leads`'s. This point reads the two runs' lengths.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../../src/constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the worm lies along, and the head's column. */
const ROW = 5;
const HEAD_C = 11;

/** Segments the worm carries, laid behind the head to column 5. */
const LENGTH = 7;

/** The segment the bolt is aimed at: the fourth from the head, at column 8. */
const BREAK_INDEX = 3;
const BREAK_C = HEAD_C - BREAK_INDEX;

/** The segments each surviving run carries: three ahead of the break, three behind. */
const RUN_LENGTHS = [3, 3];

/** The row the bolt is placed on, five rows below the worm and clear of it. */
const BOLT_R = 10;

/** How long the bolt's climb may take before the sweep gives up, in frames. */
const FLIGHT_TIMEOUT = ticksFor((3 * ((BOLT_R - ROW) * TILE)) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the head-side and tail-side runs as two worms", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);
  poseBolt(h, BREAK_C, BOLT_R);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: FLIGHT_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "split");

  assertEqual(
    swept.hit,
    true,
    `the bolt to resolve within ${FLIGHT_TIMEOUT} frames of the climb`,
  );
  const worms = swept.snapshot.worms;
  // One worm is a build that shortened the chain instead of cutting it; three is
  // one that broke it in more places than the bolt struck.
  assertLength(
    worms,
    RUN_LENGTHS.length,
    `worms on the board after the bolt struck segment ${BREAK_INDEX + 1} of ${LENGTH}`,
  );
  assertDeepEqual(
    worms.map((worm) => worm.segments.length),
    RUN_LENGTHS,
    "the segments each surviving run carries, in roster order",
  );
});
