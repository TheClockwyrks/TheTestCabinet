// worm/enters-top-row — a level's worm enters along row 0, from the edge posed
// for it, heading down.
//
// specs/worm.md, "Length and entry": "The worm enters along row `0`, the entry
// row, from the left edge or the right edge, each with probability `1/2`. Every
// one of its segments is laid on row `0`, in a run of consecutive columns that
// stands against the edge it entered at. Entering from the left, the tail
// occupies column `0` and the head column `wormLength(level) - 1` ... `dh` is
// `+1` entering from the left ... Its vertical heading `dv` is `+1`, down."
//
// THE EDGE IS POSED, SO EVERY READING IS EXACT. The edge is a coin flip the spec
// leaves to the build, and specs/instrumentation.md's `setNextWormEntry` poses
// the outcome of that one draw, so the check poses the LEFT edge and holds the
// build to the left edge's own consequences: every segment on row `0`, the tail
// on column `0`, the head on column `wormLength(level) - 1` with the run of
// columns consecutive between them, `dh` of `+1`, and `dv` of `+1`. A build that
// entered mid-board fails on the tail's column, one that laid its segments apart
// fails on the run, one that entered tail-first fails on the head's column, one
// that entered heading back off the board fails on `dh`, and one that entered
// rising fails on `dv` — each naming its own reading. That the pose is honoured
// from the right edge too is `instrumentation/set-next-worm-entry`'s.
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
import { BANNER_TIME } from "../constants";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
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

/** The edge posed for the entry, and the column its tail stands on. */
const EDGE = "left";
const TAIL_C = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays the level's worm along row 0 from the posed left edge, heading inward and down", async () => {
  startPlaying(h);
  h.debug.setWormEntry(true);
  h.debug.setNextWormEntry(EDGE);
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
  worm.segments.forEach((segment, index) => {
    assertEqual(
      segment.c,
      worm.segments.length - 1 - index,
      `segment ${index}: its column in the run of consecutive columns from ` +
        "the head back to the tail",
    );
  });
  assertEqual(worm.dh, 1, `dh on entry from the ${EDGE} edge, pointing inward`);
  assertEqual(worm.dv, 1, "dv on entry");
});
