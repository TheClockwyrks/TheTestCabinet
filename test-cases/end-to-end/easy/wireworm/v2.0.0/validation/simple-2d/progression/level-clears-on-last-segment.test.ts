// progression/level-clears-on-last-segment — removing the last segment clears the
// level.
//
// THE RULE. `specs/progression.md`, *Clearing a level*: *a level clears on the
// step in which the last of its worm segments is removed*. This point is the
// transition itself — that removing the last segment takes the run off the level
// it was on. Its converse, that a board which never held a segment is being played
// rather than cleared, is `progression/empty-board-does-not-clear`; that the
// advance is by exactly one level is `progression/level-advances`. Reading only
// that the run MOVED ON here is what keeps the three apart: a build that clears
// but advances by two fails one of the three and names which.
//
// THE SEGMENT IS REMOVED BY A REAL SHOT. A bolt is posed three tiles below it and
// climbs at `BOLT_SPEED` (`900` units per second), resolving against the segment
// through the game's own rules (`specs/cursor.md`), so what clears the level is a
// removal the build performed and not an operation that deleted an entity behind
// its back.
//
// THE WORM IS ONE SEGMENT AND IT DOES NOT MOVE. Both its faculties are off, so the
// shot is the only thing that can happen to it, and one segment means the shot
// that lands is unambiguously the LAST one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillWorm, shootUpAt } from "./scenario";

/**
 * The level the run is posed on, and where the lone segment stands.
 *
 * Well up the board, so the bolt has clear air beneath it and the segment is
 * nowhere near the band.
 */
const LEVEL = 2;
const WORM_COL = 20;
const WORM_ROW = 8;

/**
 * The ceiling on the sweep that waits for the shot to land, in frames.
 *
 * One second, in which a bolt at `BOLT_SPEED` (`900` units per second) covers 900
 * units — nearly thirty tiles, against the three it is posed below its target
 * (`specs/cursor.md`). A build whose shot has not resolved by then has not
 * resolved it at all, and the reading below is the verdict either way.
 */
const SHOT_FRAMES = ticksFor(1);

/** Frames run past the clear, so the reading is not taken on its very first frame. */
const SETTLE_FRAMES = 2;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("takes the run off the level when the last segment goes", async () => {
  startPlaying(harness);
  harness.debug.setLevel(LEVEL);
  poseStillWorm(harness, WORM_COL, WORM_ROW);
  shootUpAt(harness, WORM_COL, WORM_ROW);

  await harness.until((s) => s.worms.length === 0, {
    maxFrames: SHOT_FRAMES,
  });
  await harness.advance(SETTLE_FRAMES);

  captureStill(harness, "cleared");
  assertGreaterThan(
    harness.snapshot().level,
    LEVEL,
    "the level after the clear",
  );
});
