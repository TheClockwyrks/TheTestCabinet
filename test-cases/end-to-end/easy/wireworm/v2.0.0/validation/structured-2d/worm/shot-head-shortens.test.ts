// worm/shot-head-shortens — a bolt into the head leaves one worm, one segment
// shorter, led by what was the second segment.
//
// specs/worm.md, Cutting the worm: the survivors of a removal "fall into runs
// of consecutive segments, counted from the head end. Each run becomes a worm
// of its own", and "A bolt into the head therefore leaves one worm, one segment
// shorter, led by what was the second segment." specs/cursor.md fixes what the
// bolt strikes: it "resolves against the first thing its center reaches, which
// is the lowest of the following that lies above it in its column".
//
// THE WORLD THIS POSES. An empty, quiet board carrying one worm of four
// segments laid along a clear row, and one bolt placed in the head's column
// seven rows below it. Nothing else stands in that column, so the head is the
// first thing the bolt reaches and the cut is the one this point is about.
//
// THE WORM'S `stepping` IS HELD OFF, and that is isolation rather than
// convenience: a worm that stepped while the bolt climbed would be somewhere
// else by the time it arrived, and the check would be deciding the step clock
// (`worm.step-cadence`) as much as the cut. Its body gate is left alone,
// because a chain that does not follow is a chain, and only the chain's
// membership is read here.
//
// WHAT THE CUT LEAVES BEHIND IS NOT READ. specs/nodes.md lays a fresh node on
// the tile a shot segment died on; that is `nodes.shot-leaves-node`'s
// requirement, and it is deliberately not asserted here.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../../src/constants";
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

/** The worm posed: four segments, head at (10, 5), trailing to column 7. */
const LENGTH = 4;
const HEAD_C = 10;
const ROW = 5;

/** Where the bolt starts: the head's own column, seven rows below it. */
const BOLT_R = ROW + 7;

/**
 * How long the bolt may take to arrive, in frames.
 *
 * It climbs seven tiles — `7 * TILE` (`224`) logical units — at `BOLT_SPEED`
 * (`900` units per second), which is `0.249` s. Twice that is the timeout: it
 * is a bound on a bolt that never resolved, not a tolerance on when it did.
 */
const BOLT_TIMEOUT = ticksFor(((BOLT_R - ROW) * TILE * 2) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves one worm a segment shorter, led by the second segment", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);

  poseBoltAtTile(h, HEAD_C, BOLT_R);
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
      { c: HEAD_C - 1, r: ROW },
      { c: HEAD_C - 2, r: ROW },
      { c: HEAD_C - 3, r: ROW },
    ],
    "the chain led by what was the second segment",
  );
});
