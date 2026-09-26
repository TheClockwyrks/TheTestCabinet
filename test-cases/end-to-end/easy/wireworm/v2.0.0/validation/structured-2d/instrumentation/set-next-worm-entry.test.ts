// Wireworm — instrumentation/set-next-worm-entry: `setNextWormEntry` poses the
// edge the next worm enters at, reads back, decides that one entry, and is
// consumed by it.
//
// specs/instrumentation.md, The level's draws: `setNextWormEntry(edge)` "Poses
// the edge, `"left"` or `"right"`, the next worm the level or the respawn brings
// in enters at. It is reported as `nextWormEntry`, and reads `null` once that
// entry has consumed it", and "A worm the level brings in at a posed edge is
// laid exactly as `specs/worm.md` lays one entering from that edge".
// specs/worm.md lays a worm entering from the right with "the tail ... column
// `39` and the head column `40 - wormLength(level)`", and `dh` of `-1`.
//
// THE RIGHT EDGE IS POSED, because `worm/enters-top-row` poses the left one:
// between them a build is held to both consequences of the pose, and a build
// that ignores the pose and flips its own coin is read on the wrong edge half
// the time in each.
//
// THE ENTRY IS THE LEVEL'S OWN. `setWormEntry(true)` is turned back on after
// `startPlaying` shut it off, and the worm is let in by running the `banner`
// phase's timer out, which specs/progression.md fixes as the one moment a worm
// enters. The worm is read within a frame of its arrival, long before its first
// step is due, so what is read is the arrangement it entered in.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME, COLS, ENTRY_ROW } from "../constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The edge posed, and the column its tail stands on. */
const EDGE = "right";
const TAIL_C = COLS - 1;

/**
 * How long the banner may take to give way, in frames. `BANNER_TIME` is `1.3` s
 * (specs/progression.md); a second beyond it is a bound on a banner that never
 * ran out, not a tolerance on when it did.
 */
const ENTRY_TIMEOUT = ticksFor(BANNER_TIME + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the posed edge back, enters the worm from it, and consumes the pose", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setWormEntry(true);
  h.debug.setNextWormEntry(EDGE);

  assertEqual(
    h.snapshot().nextWormEntry,
    EDGE,
    `snapshot().nextWormEntry after setNextWormEntry(${JSON.stringify(EDGE)})`,
  );

  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_TIME);
  const swept = await h.until((s) => s.worms.length > 0, {
    maxFrames: ENTRY_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "entry");

  assertTrue(
    swept.hit,
    `a worm to enter within ${ENTRY_TIMEOUT} frames of the banner`,
  );
  assertLength(swept.snapshot.worms, 1, "worms brought in");
  const worm = swept.snapshot.worms[0];

  for (const [index, segment] of worm.segments.entries()) {
    assertEqual(
      segment.r,
      ENTRY_ROW,
      `segment ${index}: the row it entered on`,
    );
  }
  const tail = worm.segments[worm.segments.length - 1];
  assertEqual(
    tail.c,
    TAIL_C,
    `the tail's column entering from the ${EDGE} edge (specs/worm.md)`,
  );
  assertEqual(
    worm.segments[0].c,
    COLS - worm.segments.length,
    `the head's column entering from the ${EDGE} edge: 40 - wormLength(level), ` +
      `the end furthest from column ${TAIL_C} (specs/worm.md)`,
  );
  assertEqual(
    worm.dh,
    -1,
    `dh entering from the ${EDGE} edge, pointing inward`,
  );
  assertEqual(
    swept.snapshot.nextWormEntry,
    null,
    "snapshot().nextWormEntry once the entry it posed has consumed it",
  );
});
