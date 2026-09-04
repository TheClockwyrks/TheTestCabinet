// instrumentation/debug-api-live — the surface drives the running game.
//
// specs/instrumentation.md: "Every scenario driven from code reaches the game
// through it", and each operation is "a read of the game's state or a pose of
// one part of it", after which "the game's own tick ... runs from there exactly
// as [it does] in play". So the surface must be wired to the running game
// rather than answering from a copy: a pose changes it, and `snapshot` reads
// the change back.
//
// THE CLOCK IS PART OF BEING LIVE HERE, because under this engine
// `specs/instrumentation.md` puts it on the surface: with `setAutoStep(false)`
// real time passes and nothing advances, and `step` runs whole ticks on demand
// over the posed session. That the operations are PRESENT is `debug-api-present`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";

/** Real time allowed to pass with the game off the clock, nothing advancing. */
const FROZEN_MS = 500;

/** A score no boot state holds, so reading it back can only be the pose. */
const POSED_SCORE = 500;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a pose, holds it off the clock, and steps the posed session", async () => {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.setScore(POSED_SCORE);
  const posed = await h.snapshot();

  // The clock is really disconnected: the harness has already called
  // `setAutoStep(false)`, so real time is simply allowed to pass — a build
  // still feeding the wall clock into its accumulator resolves ticks while
  // this waits, and one that really disconnected does not move at all.
  assertEqual(posed.autoStep, false, "autoStep after setAutoStep(false)");
  await h.page.waitForTimeout(FROZEN_MS);
  const still = await h.snapshot();
  assertEqual(still.ticks, posed.ticks, "ticks with the clock disconnected");

  // And the game RUNS on demand: a stepped tick advances the game's own clock
  // over the posed session rather than over a copy the surface answered from.
  const after = await h.tick(1);
  await captureStill(h, "driven");

  assertEqual(posed.screen, "playing", "the posed screen, read back");
  assertEqual(posed.score, POSED_SCORE, "the posed score, read back");
  assertEqual(after.ticks, posed.ticks + 1, "ticks across one stepped tick");
  assertEqual(after.score, POSED_SCORE, "the posed score, held by the game");
});
