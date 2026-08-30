// progression/victory-on-twelve — clearing level 12 wins the run.
//
// THE RULE. `specs/progression.md`, *Winning and losing*: victory is reached when
// *the last worm segment of level `12` is removed*, and the game *moves to the
// `victory` screen*. It is the other branch of the clear
// `progression/level-advances` reads: below `TOTAL_LEVELS` the run moves on, at
// `TOTAL_LEVELS` it is won, and the two together say a build takes the right
// branch at the boundary.
//
// THE RUN IS POSED ON THE LAST LEVEL, and the last segment is removed by a real
// bolt climbing through the game's own shot rules (`specs/cursor.md`), so the
// victory is reached by the clear path rather than by an operation that set a
// screen. The level reached is posed with the level, because during a run the
// level reached is the level being played.
//
// The board carries nothing but the one motionless segment: with both its
// faculties off and the three world gates down, the shot is the only thing that
// can happen, so a `victory` screen can only have come from the clear.

import { afterEach, beforeEach, it } from "vitest";
import { TOTAL_LEVELS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillWorm, shootUpAt } from "./scenario";

/** The last of the twelve levels, where a clear wins the run. */
const LAST_LEVEL = TOTAL_LEVELS;

/** Where the lone segment stands: well up the board, with clear air beneath it. */
const WORM_COL = 20;
const WORM_ROW = 8;

/**
 * The ceiling on the sweep that waits for the shot to land, in frames. One second,
 * against a bolt at `BOLT_SPEED` (`900` units per second) posed three tiles below
 * its target (`specs/cursor.md`).
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

it("moves to the victory screen when level 12 is cleared", async () => {
  const { debug } = harness;
  startPlaying(harness);
  debug.setLevel(LAST_LEVEL);
  debug.setReachedLevel(LAST_LEVEL);
  poseStillWorm(harness, WORM_COL, WORM_ROW);
  shootUpAt(harness, WORM_COL, WORM_ROW);

  await harness.until((s) => s.worms.length === 0, { maxFrames: SHOT_FRAMES });
  await harness.advance(SETTLE_FRAMES);

  captureStill(harness, "victory");
  assertEqual(harness.snapshot().screen, "victory");
});
