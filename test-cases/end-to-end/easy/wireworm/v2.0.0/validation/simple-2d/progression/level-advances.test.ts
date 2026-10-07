// progression/level-advances — a clear advances the level by exactly one.
//
// THE RULE. `specs/progression.md`, *Clearing a level*, on a clear below
// `TOTAL_LEVELS` (`12`): *the level goes up by one*. That the clear happens at all
// is `progression/level-clears-on-last-segment`; what this point decides is the
// size of the step, so it reads the level as an exact figure. A build that jumps
// two levels, or that restarts the run at level one, reads a different number from
// one that advances the way the specification states.
//
// THE LEVEL'S WORM IS CUT DOWN SEGMENT BY SEGMENT. Two segments are posed and two
// separate shots remove them, so the clear lands on the second — the LAST — rather
// than on the first thing the build lost. Both are removed by real bolts climbing
// through the game's own shot rules (`specs/cursor.md`).
//
// THE SURVIVOR IS RE-POSED BETWEEN THE SHOTS. Cutting a worm makes new worms
// (`specs/worm.md`), and the specification fixes what a survivor inherits — the
// headings and the diving flag — while saying nothing about the two debug
// faculties, which belong to the surface rather than to the game. Turning them off
// again on whatever the cut left behind is what makes the second shot land on a
// segment standing where the first shot left it, whichever way a build carried
// them.
//
// The tail is taken first, so the node a cut segment leaves behind (`specs/worm.md`)
// stands in the tail's column and never in the head's, and the second bolt climbs
// clear air.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";
import { poseStillWorm, shootUpAt, stillEveryWorm } from "./scenario";

/** The level the run is posed on, and the level a single clear must leave it at. */
const LEVEL = 4;
const NEXT_LEVEL = LEVEL + 1;

/** Where the two-segment worm stands: head on `(20, 8)`, tail on `(19, 8)`. */
const HEAD_COL = 20;
const TAIL_COL = HEAD_COL - 1;
const WORM_ROW = 8;
const WORM_LENGTH = 2;

/**
 * The ceiling on each sweep that waits for a shot to land, in frames.
 *
 * One second, in which a bolt at `BOLT_SPEED` (`900` units per second) covers 900
 * units — nearly thirty tiles, against the three it is posed below its target
 * (`specs/cursor.md`).
 */
const SHOT_FRAMES = ticksFor(1);

/** Frames run past the clear, so the reading is not taken on its very first frame. */
const SETTLE_FRAMES = 2;

/** How many worm segments stand on the board, across every worm. */
function segmentsOnBoard(snapshot: WirewormSnapshot): number {
  return snapshot.worms.reduce(
    (total, worm) => total + worm.segments.length,
    0,
  );
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves the run one level on from the one it cleared", async () => {
  startPlaying(harness);
  harness.debug.setLevel(LEVEL);
  poseStillWorm(harness, HEAD_COL, WORM_ROW, WORM_LENGTH);

  // The tail first: one segment left, and the level still standing.
  shootUpAt(harness, TAIL_COL, WORM_ROW);
  await harness.until((s) => segmentsOnBoard(s) <= WORM_LENGTH - 1, {
    maxFrames: SHOT_FRAMES,
  });
  stillEveryWorm(harness);

  // Then the head, which is the last segment the level has.
  shootUpAt(harness, HEAD_COL, WORM_ROW);
  await harness.until((s) => s.worms.length === 0, { maxFrames: SHOT_FRAMES });
  await harness.advance(SETTLE_FRAMES);

  captureStill(harness, "advanced");
  assertEqual(harness.snapshot().level, NEXT_LEVEL);
});
