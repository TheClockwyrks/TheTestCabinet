// worm/shot-middle-splits — a bolt into a middle segment leaves two worms.
//
// specs/worm.md, Cutting the worm: the survivors of a removal "fall into runs
// of consecutive segments, counted from the head end. Each run becomes a worm
// of its own", and "A bolt into a middle segment leaves two worms, the
// head-side run and the tail-side run." specs/cursor.md fixes what the bolt
// strikes: the first thing its center reaches in its column.
//
// THE ARRANGEMENT IS THE SEVEN-AND-FOURTH ONE THE ITEM NAMES, and the numbers
// are chosen so no wrong answer can look like the right one. A seven-segment
// worm cut at its fourth segment leaves runs of THREE and THREE: a build that
// cut at the wrong segment leaves 2/4 or 4/2, one that dropped the tail-side
// run leaves one worm of three, and one that removed the whole worm leaves
// none. Cutting a six-segment worm at its third would have left 2/3, where a
// count alone could not say which side was which — so both runs are read by
// their TILES as well as their lengths.
//
// THE WORLD THIS POSES. An empty, quiet board carrying that one worm, laid
// along a clear row, and one bolt in the fourth segment's column seven rows
// below it. Nothing else stands in that column. The worm's `stepping` is held
// off, so the chain the bolt arrives at is the chain that was posed rather than
// one the step clock moved on.
//
// WHICH RUN KEEPS THE WORM'S ID IS NOT READ HERE — that is
// `worm.split-keeps-head-id`'s requirement — so the two pieces are found by the
// tiles they stand on.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  segmentTiles,
  startPlaying,
  ticksFor,
  wormOn,
  type Harness,
} from "../harness";

/** The worm posed: seven segments, head at (20, 5), tail at column 14. */
const LENGTH = 7;
const HEAD_C = 20;
const ROW = 5;

/** The segment the bolt is aimed at: the fourth, counted from the head. */
const CUT_INDEX = 4;
const CUT_C = HEAD_C - (CUT_INDEX - 1);

/** Where the bolt starts: the fourth segment's column, seven rows below it. */
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

it("leaves the head-side and tail-side runs as two worms of three", async () => {
  startPlaying(h);
  const id = poseWorm(h, HEAD_C, ROW, LENGTH, 1, 1);
  h.debug.setWormStepping(id, false);

  poseBoltAtTile(h, CUT_C, BOLT_R);
  const swept = await h.until((s) => segmentTiles(s).length < LENGTH, {
    maxFrames: BOLT_TIMEOUT,
    poll: 1,
  });

  captureStill(h, "split");

  assertEqual(
    swept.hit,
    true,
    `the bolt to remove a segment within ${BOLT_TIMEOUT} frames`,
  );
  assertLength(swept.snapshot.worms, 2, "worms left on the board");
  assertDeepEqual(
    wormOn(swept.snapshot, HEAD_C, ROW)?.segments,
    [
      { c: HEAD_C, r: ROW },
      { c: HEAD_C - 1, r: ROW },
      { c: HEAD_C - 2, r: ROW },
    ],
    "the head-side run",
  );
  assertDeepEqual(
    wormOn(swept.snapshot, HEAD_C - (LENGTH - 1), ROW)?.segments,
    [
      { c: CUT_C - 1, r: ROW },
      { c: CUT_C - 2, r: ROW },
      { c: CUT_C - 3, r: ROW },
    ],
    "the tail-side run, led by the segment nearest the break",
  );
});
