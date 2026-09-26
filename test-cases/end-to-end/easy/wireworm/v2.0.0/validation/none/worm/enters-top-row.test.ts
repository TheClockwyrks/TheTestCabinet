// worm/enters-top-row — the level's worm enters along row 0, from the edge
// posed for it, descending.
//
// specs/worm.md, "Length and entry": "The worm enters along row `0`, the entry
// row, from the left edge or the right edge, each with probability `1/2`. Every
// one of its segments is laid on row `0`, in a run of consecutive columns that
// stands against the edge it entered at. Entering from the left, the tail
// occupies column `0` and the head column `wormLength(level) - 1` ... Its
// horizontal heading points inward from the edge it entered at: `dh` is `+1`
// entering from the left ... Its vertical heading `dv` is `+1`, down."
//
// THE EDGE IS POSED, SO EVERY READING IS EXACT. The edge is a coin flip the
// spec leaves to the build, and specs/instrumentation.md's `setNextWormEntry`
// poses the outcome of that one draw, so the check poses the LEFT edge and
// holds the build to the left edge's own consequences: every segment on row 0,
// the tail on column 0, the head on column `wormLength(level) - 1`, `dh` of
// `+1`, and `dv` of `+1`. A build that entered mid-board fails on the tail's
// column, one that entered tail-first fails on the head's, one that entered
// heading back off the board fails on `dh`, and one that entered rising fails
// on `dv` — each naming its own reading. That the pose itself is honoured from
// the right edge is `instrumentation/set-next-worm-entry`'s point.
//
// How MANY segments entered is `worm.length-per-level`'s requirement and is not
// asserted here beyond what the head's column implies.
//
// WHAT DRIVES THE ENTRY. The level's own worm entry, not `addWorm`:
// `setWormEntry(true)` is turned back on after `startPlaying` shut it off, and the
// worm is let in the way play lets it in — by running the `banner` phase's timer
// out, which specs/progression.md fixes as the one moment a worm enters. Foe
// spawning stays off and no worm is posed by hand, so the only worm on the board
// is the one the level brought.
//
// The worm is read within a frame of its arrival, long before its first step is
// due, so what is read is the arrangement it entered in.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME, ENTRY_ROW } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * How long the banner may take to give way, in frames. `BANNER_TIME` is `1.3` s
 * (specs/progression.md); a second beyond it is a bound on a banner that never ran
 * out, not a tolerance on when it did.
 */
const ENTRY_TIMEOUT = framesFor(BANNER_TIME + 1);

/** The edge posed for the entry, and the column its tail stands on. */
const EDGE = "left";
const TAIL_C = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lays the level's worm along row 0 from the posed left edge, descending", async () => {
  await h.debug.reset();
  await startPlaying(h);
  await h.debug.setWormEntry(true);
  await h.debug.setNextWormEntry(EDGE);
  await h.debug.setPhase("banner");
  await h.debug.setPhaseTimer(BANNER_TIME);

  const swept = await h.until((s) => s.worms.length > 0, {
    maxFrames: ENTRY_TIMEOUT,
    poll: 1,
  });

  await captureStill(h, "entry");

  assertEqual(
    swept.hit,
    true,
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
    worm.segments.length - 1,
    `the head's column entering from the ${EDGE} edge: wormLength(level) - 1, ` +
      `the end furthest from column ${TAIL_C} (specs/worm.md)`,
  );
  for (const [index, segment] of worm.segments.entries()) {
    assertEqual(
      segment.c,
      worm.segments.length - 1 - index,
      `segment ${index}: its column in the run of consecutive columns from ` +
        `the head back to the tail`,
    );
  }
  assertEqual(worm.dh, 1, `dh entering from the ${EDGE} edge, pointing inward`);
  assertEqual(worm.dv, 1, "dv, descending");
});
