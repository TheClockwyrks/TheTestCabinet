// Wireworm — instrumentation/worm-body-gate: a worm whose body is gated off
// advances its head and leaves every trailing segment on the tile it was posed
// on.
//
// specs/instrumentation.md gives the operation exactly one faculty:
// `setWormBody(id, enabled)` "Gates the body's follow alone. Off, the head steps
// as usual and every trailing segment holds its tile." specs/worm.md states the
// follow it gates: every step, once the head has moved, each remaining segment
// moves into the tile the segment ahead of it occupied before that step.
//
// IT IS WHAT MAKES A CHECK ON THE HEAD READABLE. A point that decides where a
// blocked head goes, or which tile a dive ends on, wants one tile to have moved
// and one reading to take; with the body following, the same step moves every
// segment of the chain and the reading is of the whole worm. So the worm points
// pose a body-gated worm to read the head alone, and this point is where that
// gate is decided.
//
// ONE WORM, FIVE SEGMENTS, ON AN EMPTY ROW. The requirement is the follow, so
// the chain is straight and nothing stands in front of it: no node to block
// against, no second worm, no foe. A five-segment worm is enough that a build
// that moves the chain a segment short, or that drags only the tail, is caught
// as surely as one that moves the whole of it.
//
// THE HEAD IS READ LOOSELY AND ON PURPOSE. It is asserted only to have moved off
// its tile, not to have advanced a set number of tiles: this point is about the
// gate, and `worm/step-cadence` grades the interval. Three level-1 intervals is
// a span a build as much as three times slower than the figure still steps
// within, so a cadence defect cannot make this point fail for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import { WORM_STEP_L1 } from "../constants";
import { assertDeepEqual, assertLength, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseWorm,
  startPlaying,
  wormById,
  type Harness,
  type Tile,
} from "../harness";

/** The tile the worm's head is posed on, and how many segments trail it. */
const HEAD_C = 10;
const HEAD_R = 5;
const LENGTH = 5;

/**
 * How many level-1 step intervals the worm is driven for.
 *
 * Three, which specs/worm.md makes `3 * WORM_STEP_L1` (`0.42` s) at level 1.
 * Three rather than one so the head is read generously: a build whose interval
 * is as much as three times the figure still steps inside this span, and the
 * held segments are held to their tiles however many steps the head took.
 */
const INTERVALS = 3;

/** That span in frames of the suite's clock. */
const DRIVE_FRAMES = framesFor(INTERVALS * WORM_STEP_L1);

/** A tile as `"c,r"`, so a failure reads as a tile rather than as an object. */
function at(tile: Tile | undefined): string {
  return tile === undefined ? "no segment" : `${tile.c},${tile.r}`;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("advances the head and holds every trailing segment on its tile", async () => {
  await startPlaying(h);

  const id = await poseWorm(h, { c: HEAD_C, r: HEAD_R, length: LENGTH });
  await h.debug.setWormBody(id, false);

  const posed = wormById(await h.snapshot(), id);
  assertLength(
    posed?.segments ?? [],
    LENGTH,
    `the segments of the worm this scenario posed — poseWorm builds it one ` +
      `segment at a time through addWorm and appendSegment`,
  );
  const trailing = (posed?.segments ?? []).slice(1).map(at);

  await h.advance(DRIVE_FRAMES);
  // Before the assertions, so a failing gate still leaves the picture of the
  // head advanced ahead of its held body.
  await captureStill(h, "gated");

  const driven = wormById(await h.snapshot(), id);
  assertLength(
    driven?.segments ?? [],
    LENGTH,
    `the segments of the worm after ${INTERVALS} level-1 step intervals — ` +
      `gating the body holds the trailing segments, it does not remove them`,
  );

  // The head stepped, so "the body held" is a reading rather than a statement
  // about a worm that never moved.
  assertNotEqual(
    at(driven?.segments[0]),
    `${HEAD_C},${HEAD_R}`,
    `the head tile after ${INTERVALS} level-1 step intervals ` +
      `(${(INTERVALS * WORM_STEP_L1).toFixed(2)} s of game time), which is ` +
      `the tile it was posed on — the gate holds the body, not the head`,
  );

  // And every segment behind it stayed exactly where it was posed.
  assertDeepEqual(
    (driven?.segments ?? []).slice(1).map(at),
    trailing,
    `the tiles the ${LENGTH - 1} trailing segments stand on, against the ` +
      `tiles they were posed on, with setWormBody(${id}, false) held`,
  );
});
