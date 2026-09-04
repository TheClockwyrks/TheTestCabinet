// cursor/bolt-stops-at-segment — a bolt resolves against the FIRST worm segment
// in its column and removes that one alone.
//
// specs/cursor.md: "it resolves against the first thing its center reaches ... A
// bolt resolves against exactly one thing and is removed from flight in the same
// update." specs/worm.md: "A bolt travelling up a column destroys the first worm
// segment in its path ... Every segment dies to one hit, whatever its place in
// the chain."
//
// THE WORLD IS ONE THREE-SEGMENT WORM AND ONE BOLT. `startPlaying` empties the
// field and the rosters, and the scenario puts back a chain long enough to have a
// middle: the bolt climbs the middle segment's column, so "removes that segment
// and no other" is a reading about the two segments either side of it as much as
// about the one it struck. A bolt into the head or the tail could not tell a
// build that removed one segment from a build that removed the whole chain.
//
// THE WORM IS POSED WITH BOTH FACULTIES OFF, which is the isolation this
// requirement needs: with `setWormStepping(false)` and `setWormBody(false)` the
// chain holds the three tiles it was posed on, so where each segment stands is
// the bolt's doing and nothing else's. The step clock, the block test and the
// body's follow are specs/worm.md's own points, and none of them can reach this
// reading.
//
// THE BOARD IS READ AT THE UPDATE THE BOLT LEFT FLIGHT, not at the end of a fixed
// window. specs/worm.md does not say a worm's surviving runs inherit the faculty
// gates the posed worm carried, so a build is free to hand a fresh run a running
// step clock; reading at the strike means this point never depends on that
// answer, and never depends on the bolt's rate beyond its arriving inside a
// generous ceiling — the rate is `cursor.bolt-travels-up`'s requirement.
//
// WHAT THIS DOES NOT DECIDE. That the survivors fall into two worms with the
// stated ids is `worm.shot-splits-chain`'s requirement, and that the dead segment
// leaves a fresh inert node behind is `nodes.shot-segment-lays-node`'s. This
// point counts segments and reads tiles: three went in, two stand, and the one
// the bolt climbed to is the one that is gone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  boltOf,
  captureStill,
  createHarness,
  poseBolt,
  poseWorm,
  segmentAt,
  seconds,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The column the bolt climbs: the middle segment's. */
const COLUMN = 12;

/** The row the chain is laid along, well above the player band. */
const ROW = 8;

/** How many segments the posed chain carries: a head, a middle, and a tail. */
const CHAIN = 3;

/** The row the bolt is posed on: the floor, whose centre y is 704. */
const START_ROW = 19;

/** Segments still standing once the bolt has taken the middle one. */
const SURVIVORS = CHAIN - 1;

/**
 * How long the bolt is given to reach the chain, in frames of the 120 Hz clock.
 *
 * From row 19's centre (704) the chain's tiles begin at y = 368, which a bolt at
 * `BOLT_SPEED` covers in 0.373 s. The ceiling is 0.6 s — 60% past that — because
 * it is a ceiling and not a measurement: the sweep stops at the update the bolt
 * leaves flight, so the only thing this figure decides is how wrong a build's
 * bolt rate has to be before this point stops being able to read the strike at
 * all. `cursor.bolt-travels-up` is what grades the rate.
 */
const REACH_CEILING = ticksFor(0.6);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the segment in the bolt's column and leaves the two beside it", async () => {
  startPlaying(h);
  // The head is one column to the right of the bolt's, so the chain laid behind
  // it — `poseWorm` lays the body along the head's row, behind the head — covers
  // COLUMN + 1, COLUMN and COLUMN - 1, and the bolt climbs to the middle one.
  const wormId = poseWorm(h, COLUMN + 1, ROW, CHAIN, 1, 1);
  h.debug.setWormStepping(wormId, false);
  h.debug.setWormBody(wormId, false);
  const boltId = poseBolt(h, COLUMN, START_ROW);

  const struck = await h.until((board) => boltOf(board, boltId) === null, {
    maxFrames: REACH_CEILING,
    poll: 1,
  });
  captureStill(h, "consumed");

  assertTrue(
    struck.hit,
    `whether the bolt (id ${boltId}) left flight within ${REACH_CEILING} ` +
      `frames (${seconds(REACH_CEILING)} s) of climbing the column the chain ` +
      `lies across — specs/cursor.md: it resolves against the segment on ` +
      `(${COLUMN}, ${ROW}) and is removed from flight in the same update, ` +
      `which at BOLT_SPEED (${BOLT_SPEED}) is 0.373 s in`,
  );

  const board = struck.snapshot;
  assertTrue(
    !segmentAt(board, COLUMN, ROW),
    `whether any worm still stands on (${COLUMN}, ${ROW}), the tile the bolt ` +
      "climbed to — specs/worm.md: a bolt destroys the first segment in its path",
  );
  assertTrue(
    segmentAt(board, COLUMN + 1, ROW),
    `whether a worm still stands on (${COLUMN + 1}, ${ROW}), the head-side ` +
      "tile the bolt never reached — specs/cursor.md: a bolt resolves against " +
      "exactly one thing",
  );
  assertTrue(
    segmentAt(board, COLUMN - 1, ROW),
    `whether a worm still stands on (${COLUMN - 1}, ${ROW}), the tail-side ` +
      "tile the bolt never reached",
  );
  assertEqual(
    board.worms.reduce((count, worm) => count + worm.segments.length, 0),
    SURVIVORS,
    `segments standing on the board after the strike, from the ${CHAIN} that ` +
      "were posed — specs/worm.md: every segment dies to one hit, and one hit " +
      "landed",
  );
});
