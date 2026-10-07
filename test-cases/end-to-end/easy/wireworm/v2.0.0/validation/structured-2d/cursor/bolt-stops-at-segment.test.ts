// cursor/bolt-stops-at-segment — a bolt is consumed by the FIRST worm segment
// in its column and removes no other.
//
// specs/cursor.md: a climbing bolt "resolves against the first thing its center
// reaches", a worm segment among them, and "a bolt resolves against exactly one
// thing and is removed from flight in the same update". specs/worm.md: "A bolt
// travelling up a column destroys the first worm segment in its path", and
// "every segment dies to one hit, whatever its place in the chain".
//
// THE WORM IS LAID ACROSS THE COLUMN, so the shot has one segment of it in its
// path and four out of it. A bolt that took the whole worm, or that took a
// neighbour instead, or that took nothing, each reads as a different set of
// surviving tiles.
//
// THE WORM IS FROZEN. Both of its faculties are held off, so it neither steps
// nor follows while the bolt climbs: the requirement here is what the bolt does
// to a segment, and a worm that walked out from under the shot would put the
// worm's own step clock into the reading. How a worm steps is `worm`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
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

/** The column the shot goes up. */
const COLUMN = 20;

/** The row the worm lies along, and the head's column: it trails to the left. */
const WORM_ROW = 10;
const HEAD_COLUMN = 22;
const WORM_LENGTH = 5;

/** The row the bolt starts on, below the worm. */
const START_ROW = 14;

/**
 * How long the sweep waits for the bolt to leave flight, in frames: two
 * seconds, for the reason `cursor/bolt-stops-at-node` states.
 */
const SWEEP_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the segment in its column and no other", async () => {
  startPlaying(h);
  const worm = poseWorm(h, HEAD_COLUMN, WORM_ROW, WORM_LENGTH);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBoltAtTile(h, COLUMN, START_ROW);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: SWEEP_TICKS,
  });
  captureStill(h, "consumed");

  assertEqual(swept.hit, true, "the bolt leaves flight");
  assertUndefined(
    wormOn(swept.snapshot, COLUMN, WORM_ROW),
    `the segment on (${COLUMN}, ${WORM_ROW}) is destroyed`,
  );
  assertLength(
    segmentTiles(swept.snapshot),
    WORM_LENGTH - 1,
    "one segment of the five is gone",
  );
  for (let c = HEAD_COLUMN - WORM_LENGTH + 1; c <= HEAD_COLUMN; c += 1) {
    if (c === COLUMN) continue;
    assertEqual(
      wormOn(swept.snapshot, c, WORM_ROW) !== undefined,
      true,
      `the segment on (${c}, ${WORM_ROW}) still stands`,
    );
  }
});
