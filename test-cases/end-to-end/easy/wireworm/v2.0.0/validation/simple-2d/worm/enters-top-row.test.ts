// worm/enters-top-row — a level's worm enters along row 0, from a side edge,
// heading down.
//
// specs/worm.md, "Length and entry": "The worm enters along row `0`, the entry
// row, from the left edge or the right edge. Every one of its segments is laid on
// row `0`, the head furthest from the edge it entered at and the tail nearest it.
// Its horizontal heading points inward from that edge, and its vertical heading is
// down."
//
// WHICH EDGE IS THE BUILD'S, SO THE CHECK READS THE EDGE IT USED. The spec fixes
// the row, the descent and that the entry is from a side edge; it deliberately
// leaves the SIDE open, and a build is free to draw it from the seeded generator.
// So the reading is: every segment on row `0`; the segments occupying a run of
// consecutive columns; that run standing against column `0` or column `39`; the
// head at the end furthest from that edge; the horizontal heading pointing inward
// from it; and the vertical heading down. A build that entered mid-board fails on
// the run standing against an edge, one that laid its segments apart fails on the
// run being consecutive, one that entered tail-first fails on the head's column,
// one that entered heading back off the board fails on the heading, and one that
// entered rising fails on the descent — each naming its own reading.
//
// THE ENTRY GATE IS TURNED BACK ON, AND IT IS THIS POINT'S REQUIREMENT.
// `startPlaying` shuts `wormEntry` so no other check is invaded by a worm it did
// not pose; how a LEVEL enters its worm is what this point is about.
// `foeSpawning` and the cursor's contact test stay shut.
//
// HOW THE WORM IS BROUGHT IN. specs/progression.md: "When the `banner` phase's
// timer runs out, the phase becomes `active` and the level's worm enters ... at
// that moment and at no other." The scenario poses the banner phase with its timer
// at zero and reads the board the moment a worm is on it, so what is measured is
// the worm AS IT ENTERED rather than one that has since stepped.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME, COLS } from "../../src/constants";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** How long the banner may take to give way before the sweep gives up, in frames. */
const ENTRY_TIMEOUT = ticksFor(BANNER_TIME * 2);

/** The row a worm enters along. */
const ENTRY_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays the level's worm along row 0 at a side edge, heading inward and down", async () => {
  startPlaying(h);
  h.debug.setWormEntry(true);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(0);

  const swept = await h.until((s) => s.worms.length > 0, {
    maxFrames: ENTRY_TIMEOUT,
    poll: 1,
  });
  captureStill(h, "entry");

  assertEqual(
    swept.hit,
    true,
    `a worm on the board within ${ENTRY_TIMEOUT} frames of the banner's timer ` +
      "running out",
  );
  assertLength(swept.snapshot.worms, 1, "worms the level brought in");
  const worm = swept.snapshot.worms[0];

  const rows = [...new Set(worm.segments.map((tile) => tile.r))].sort(
    (a, b) => a - b,
  );
  assertDeepEqual(
    rows,
    [ENTRY_ROW],
    "the rows the entering worm's segments occupy",
  );

  const columns = worm.segments.map((tile) => tile.c);
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
    `the run to stand against column 0 or column ${COLS - 1}, which is what ` +
      "entering from a side edge means",
  );

  // The head is the end furthest from the edge entered at, the tail the end
  // nearest it.
  assertEqual(
    worm.segments[0].c,
    fromLeft ? rightmost : leftmost,
    fromLeft
      ? "entering from the left: the head, furthest from column 0"
      : `entering from the right: the head, furthest from column ${COLS - 1}`,
  );

  // Inward from whichever edge the build drew: rightward off the left edge,
  // leftward off the right edge.
  assertEqual(
    worm.dh,
    fromLeft ? 1 : -1,
    `dh on entry, from the ${fromLeft ? "left" : "right"} edge`,
  );
  assertEqual(worm.dv, 1, "dv on entry");
});
