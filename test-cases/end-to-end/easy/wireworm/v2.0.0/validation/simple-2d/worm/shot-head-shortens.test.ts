// worm/shot-head-shortens — a bolt into the head leaves one worm, one segment
// shorter, led by what was the second segment.
//
// specs/worm.md, "Cutting the worm": "A bolt travelling up a column destroys the
// first worm segment in its path ... the segments that survive fall into runs of
// consecutive segments, counted from the head end. Each run becomes a worm of its
// own", and the section states this case outright: "A bolt into the head therefore
// leaves one worm, one segment shorter, led by what was the second segment."
//
// THE WORM IS POSED STILL. Its STEP faculty is off, which specs/instrumentation.md
// states gates "the block test on the tile ahead, the charge it deals, the heading
// change, the dive it enters, and the head's advance", leaving the rest of the
// board running. The requirement is what the BOLT does to the chain, so the worm
// is posed as the target and nothing about its own motion can move the segment out
// from under the bolt while it climbs. How it steps is graded by
// `worm.winds-horizontal` and `worm.step-cadence`.
//
// THE WORLD IS ONE WORM AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, so no node stands in the bolt's column to consume it
// on the way — specs/cursor.md has a bolt resolve against the FIRST thing in its
// path — and no foe or second worm exists. The bolt is placed with `addBolt` and
// climbs through the game's own shot code; a bolt the cursor FIRED would grade the
// firing as well, which is `cursor.fire-interval`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../../src/constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  headOf,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the worm lies along, and the head's column. */
const ROW = 5;
const HEAD_C = 11;

/** Segments the worm carries: enough that a head shot leaves a chain behind. */
const LENGTH = 4;

/** The row the bolt is placed on, five rows below the worm and clear of it. */
const BOLT_R = 10;

/**
 * How long the bolt's climb may take before the sweep gives up, in frames.
 *
 * Three times the `(BOLT_R - ROW) * TILE / BOLT_SPEED` the five tiles are worth at
 * `BOLT_SPEED` (`900` units per second, specs/cursor.md). It is a TIMEOUT rather
 * than a tolerance: how fast a bolt climbs is `cursor.bolt-travels-up`'s
 * requirement.
 */
const FLIGHT_TIMEOUT = ticksFor((3 * ((BOLT_R - ROW) * TILE)) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one worm a segment shorter, led by the old second segment", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);
  poseBolt(h, HEAD_C, BOLT_R);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: FLIGHT_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "shortened");

  assertEqual(
    swept.hit,
    true,
    `the bolt to resolve within ${FLIGHT_TIMEOUT} frames of the climb`,
  );
  const worms = swept.snapshot.worms;
  // One worm: a build that split the chain at its head reads two.
  assertLength(worms, 1, "worms on the board after the bolt struck the head");
  assertLength(
    worms[0].segments,
    LENGTH - 1,
    "segments of the surviving worm, one fewer than the four posed",
  );
  assertDeepEqual(
    headOf(worms[0]),
    { c: HEAD_C - 1, r: ROW },
    "the head of the surviving worm: the tile the second segment stood on",
  );
});
