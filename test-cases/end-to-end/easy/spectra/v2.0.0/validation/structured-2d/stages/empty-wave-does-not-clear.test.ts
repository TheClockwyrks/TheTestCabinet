// stages/empty-wave-does-not-clear — a wave that never held a drone is playing.
//
// specs/stages.md, The sequence: "A live wave that holds no drone and has had none
// removed is being played rather than cleared, so a stage that was never given a
// drone never clears." This is the negative half of the stage-clear rule, and it
// is graded as a point of its own rather than folded into
// `stages/clears-on-last-drone` for two reasons. A build that clears on an EMPTY
// BOARD and a build that never clears AT ALL would otherwise be indistinguishable,
// though they are opposite faults. And the rule is what makes an empty posed field
// safe: every other point in this project poses its scenario into a live wave
// holding only what that point is about, which a build that clears on an empty
// roster would end under them.
//
// WHAT IS DRIVEN. `startPosed` opens a live wave holding nothing, with the wave's
// three gates shut so nothing arrives to fill it, and the game runs. Nothing else
// is touched: no drone is posed, none is removed, and no bullet is fired, so the
// wave really is one that never held a drone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * How long the empty wave is left playing, in seconds.
 *
 * The manifest's own figure, and comfortably longer than every hold the game
 * keeps: `STAGE_INTRO_HOLD` and `STAGE_CLEARED_HOLD` are 2.0 s and 2.6 s, and the
 * dive schedule's longest gap is 2.6 s, so a build that ends the wave on any timer
 * of its own rather than on a destroyed drone has had four chances to do it.
 */
const PLAYED_FOR = 10;

/**
 * Game time between two samples, in seconds.
 *
 * Half a second, so the span above is read at twenty points rather than at its
 * ends: a build that clears the wave and re-opens the next stage inside the span
 * is caught in the middle rather than passing on the state it came back to.
 */
const SAMPLE_EVERY = 0.5;

/** Frames run before the picture is kept, so the canvas carries a live frame. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps a wave that never held a drone playing rather than clearing it", async () => {
  startPosed(h);

  const left = await h.until(
    (snapshot) => snapshot.screen !== "inWave" || snapshot.phase !== "live",
    { maxFrames: ticksFor(PLAYED_FOR), poll: ticksFor(SAMPLE_EVERY) },
  );
  await h.advance(SETTLE_FRAMES);
  captureStill(h, "playing");

  assertLength(
    left.snapshot.drones,
    0,
    "an empty field, which is what the wave was given and what nothing added to",
  );
  assertTrue(
    !left.hit,
    `the live wave still playing after ${PLAYED_FOR} s with no drone ever on it (specs/stages.md)`,
  );
  assertEqual(
    left.snapshot.screen,
    "inWave",
    "the screen an empty live wave stays on (specs/stages.md)",
  );
});
