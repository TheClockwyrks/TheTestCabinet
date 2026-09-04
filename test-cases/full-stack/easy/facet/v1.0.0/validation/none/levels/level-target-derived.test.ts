// levels/level-target-derived — the level target is LEVEL_TARGET_STEP times the
// level, and it is worked out from the level rather than stored beside it.
//
// specs/rules.md fixes the figure: "The level target is LEVEL_TARGET_STEP (2000)
// x level, so level 1 asks for 2000 points and level 4 asks for 8000."
// specs/instrumentation.md lists `levelTarget` among the four snapshot fields
// that are DERIVED rather than read off a stored value, and names the same
// product as what derives it.
//
// SO ONE READING WOULD DECIDE NOTHING. A build that reports a constant 2000, or
// one that banks a target when a level opens and never recomputes it, agrees with
// the specification at level 1 and parts company by level 4. The relation is
// therefore read at three levels, one of them well past any level a hand-played
// round reaches, and each reading is compared with the product the specification
// states for that level.
//
// `setLevel` is what poses each of them, and specs/instrumentation.md says it
// leaves the board and `levelScore` where they were — so between two readings the
// only thing that moved is the level itself, and the target must move with it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { LEVEL_TARGET_STEP } from "../constants";
import {
  captureStill,
  createHarness,
  startRound,
  type Harness,
} from "../harness";

/**
 * The levels the relation is read at: the first one, the one the specification
 * works the example out at, and one far beyond it.
 *
 * Nine is there so a build that stored a target and topped it up by
 * LEVEL_TARGET_STEP on each level change cannot pass by having been walked up
 * one level at a time — nothing walks it here, it is posed outright.
 */
const LEVELS = [1, 4, 9] as const;

/** The level the kept picture of the readout is taken at. */
const PICTURED = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports LEVEL_TARGET_STEP times the level as the level's target", async () => {
  // A round is opened first, so the target is read on the screen that plays for
  // it rather than off a title screen's resting values.
  await startRound(h);

  for (const level of LEVELS) {
    await h.debug.setLevel(level);
    const posed = await h.snapshot();

    // The level really is the one that was posed — otherwise a target that
    // happened to match would be answering a different question.
    assertEqual(posed.level, level, "the level that was posed");
    assertEqual(
      posed.levelTarget,
      LEVEL_TARGET_STEP * level,
      `the target at level ${level}`,
    );

    if (level === PICTURED) {
      // One frame, so the picture is of the readout drawn at this level rather
      // than of whatever stood on the canvas before it was posed.
      await h.advance(1);
      await captureStill(h, "hud");
    }
  }
});
