// worm/enters-top-row — the level's worm enters along row 0, from a side edge,
// descending.
//
// specs/worm.md, Length and entry: "The worm enters along row `0`, the entry
// row, from the left edge or the right edge. Every one of its segments is laid
// on row `0`, the head furthest from the edge it entered at and the tail
// nearest it. Its horizontal heading points inward from that edge, and its
// vertical heading is down."
//
// WHAT IS READ, AND WHY IN THAT SHAPE. The rule names an edge without naming
// WHICH — specs/instrumentation.md draws the entry side from the run's own
// seeded generator — so the check reads which edge the worm actually touched
// and then holds the build to that edge's own consequences:
//
//   * every segment stands on row 0;
//   * the segments occupy a RUN of consecutive columns, which is what "laid on
//     row 0" with the head at one end and the tail at the other means;
//   * that run reaches column 0 or column `COLS - 1` (`39`), which is what
//     entering FROM an edge means;
//   * the head is the end furthest from the edge reached, and the horizontal
//     heading points away from it, inward across the board;
//   * the vertical heading is down.
//
// How MANY segments entered is `worm.length-per-level`'s requirement and is not
// asserted here.
//
// WHAT DRIVES THE ENTRY. The level's own worm entry, not `addWorm`:
// `setWormEntry(true)` is turned back on after `startPlaying` shut it off, and
// the worm is let in the way play lets it in — by running the `banner` phase's
// timer out, which specs/progression.md fixes as the one moment a worm enters.
// Foe spawning stays off and no worm is posed by hand, so the only worm on the
// board is the one the level brought.
//
// The worm is read within a frame of its arrival, long before its first step is
// due, so what is read is the arrangement it entered in.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME, COLS } from "../constants";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The row a worm enters along. */
const ENTRY_ROW = 0;

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

it("lays the level's worm along row 0 from a side edge, descending", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setWormEntry(true);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_TIME);

  const swept = await h.until((s) => s.worms.length > 0, {
    maxFrames: ENTRY_TIMEOUT,
    poll: 1,
  });

  captureStill(h, "entry");

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

  const columns = worm.segments.map((segment) => segment.c);
  const leftmost = Math.min(...columns);
  const rightmost = Math.max(...columns);
  assertEqual(
    rightmost - leftmost,
    worm.segments.length - 1,
    "the entering worm occupies a run of consecutive columns",
  );

  const fromLeft = leftmost === 0;
  const fromRight = rightmost === COLS - 1;
  assertTrue(
    fromLeft || fromRight,
    `the run to reach column 0 or column ${COLS - 1}, which is what entering from a side edge means`,
  );

  // The head is the end furthest from the edge reached, and the heading points
  // inward from it.
  assertEqual(
    worm.segments[0].c,
    fromLeft ? rightmost : leftmost,
    fromLeft
      ? "entering from the left: the head, furthest from column 0"
      : `entering from the right: the head, furthest from column ${COLS - 1}`,
  );
  assertEqual(
    worm.dh,
    fromLeft ? 1 : -1,
    fromLeft
      ? "entering from the left: dh, pointing inward"
      : "entering from the right: dh, pointing inward",
  );
  assertEqual(worm.dv, 1, "dv, descending");
});
