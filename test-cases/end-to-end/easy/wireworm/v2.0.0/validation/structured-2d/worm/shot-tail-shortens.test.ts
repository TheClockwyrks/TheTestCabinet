// worm/shot-tail-shortens — a bolt into the tail leaves one worm, one segment
// shorter, with the same head.
//
// specs/worm.md, Cutting the worm: the survivors of a removal fall into runs
// counted from the head end, "The first surviving run, counted from the head
// end, keeps the worm's id, its two headings, and its diving flag", and "A bolt
// into the tail leaves one worm, one segment shorter, with the same head."
// specs/cursor.md fixes what the bolt strikes: the first thing its center
// reaches in its column.
//
// THE WORLD THIS POSES. An empty, quiet board carrying one worm of four
// segments laid along a clear row, and one bolt placed in the TAIL's column
// seven rows below it. Nothing else stands in that column, so the tail is the
// first thing the bolt reaches.
//
// THE WORM'S `stepping` IS HELD OFF, so the chain the bolt arrives at is the
// chain that was posed rather than one the step clock moved on
// (`worm.step-cadence` is the clock's own point). The body gate is left alone.
//
// WHAT THE CUT LEAVES BEHIND IS NOT READ: the fresh node on the tile the shot
// segment died on is `nodes.shot-leaves-node`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  startPlaying,
  ticksFor,
  segmentTiles,
  type Harness,
} from "../harness";

/** The worm posed: four segments, head at (10, 5), tail at column 7. */
const LENGTH = 4;
const HEAD_C = 10;
const ROW = 5;
const TAIL_C = HEAD_C - (LENGTH - 1);

/** Where the bolt starts: the tail's own column, seven rows below it. */
const BOLT_R = ROW + 7;

/**
 * How long the bolt may take to arrive, in frames: twice the `0.249` s that
 * seven tiles of `TILE` (`32`) units take at `BOLT_SPEED` (`900` units per
 * second). A bound on a bolt that never resolved, not a tolerance.
 */
const BOLT_TIMEOUT = ticksFor(((BOLT_R - ROW) * TILE * 2) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one worm a segment shorter, with the same head", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);

  poseBoltAtTile(h, TAIL_C, BOLT_R);
  // Read across the WHOLE board rather than off the posed worm's id: which
  // worm carries which id after a cut is `worm.split-keeps-head-id`'s
  // requirement, and this point should not answer it by accident.
  const swept = await h.until((s) => segmentTiles(s).length < LENGTH, {
    maxFrames: BOLT_TIMEOUT,
    poll: 1,
  });

  captureStill(h, "shortened");

  assertEqual(
    swept.hit,
    true,
    `the bolt to remove a segment within ${BOLT_TIMEOUT} frames`,
  );
  assertLength(swept.snapshot.worms, 1, "worms left on the board");
  assertDeepEqual(
    swept.snapshot.worms[0]?.segments,
    [
      { c: HEAD_C, r: ROW },
      { c: HEAD_C - 1, r: ROW },
      { c: HEAD_C - 2, r: ROW },
    ],
    "the chain still led by its own head, one segment shorter at the tail",
  );
});
