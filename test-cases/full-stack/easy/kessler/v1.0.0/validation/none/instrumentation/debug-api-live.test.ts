// instrumentation/debug-api-live — the surface drives the running game.
//
// specs/instrumentation.md: "Every scenario driven from code reaches the game
// through it", and each operation is "a read of the game's state or a pose of
// one part of it", after which "the game's own tick ... runs from there exactly
// as [it does] in play". So the surface must be wired to the running game
// rather than answering from a copy: a pose changes it, and `snapshot` reads
// the change back.
//
// THE STEPPED TICK IS PART OF BEING LIVE HERE, because under this engine
// `specs/instrumentation.md` puts the clock on the surface: the harness holds
// the game with `setAutoStep(false)`, and `step` runs whole ticks on demand
// over the posed session. What is read is that a stepped tick advances the
// game's own counter over the POSED session rather than over a copy the
// surface answered from. That the operations are PRESENT is
// `debug-api-present`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";

/** A score no boot state holds, so reading it back can only be the pose. */
const POSED_SCORE = 500;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a pose and steps the posed session on from it", async () => {
  await h.debug.reset();
  await h.debug.setScreen("playing");
  await h.debug.setScore(POSED_SCORE);
  const posed = await h.snapshot();

  const after = await h.tick(1);
  await captureStill(h, "driven");

  assertEqual(posed.screen, "playing", "the posed screen, read back");
  assertEqual(posed.score, POSED_SCORE, "the posed score, read back");
  assertEqual(after.ticks, posed.ticks + 1, "ticks across one stepped tick");
  assertEqual(after.score, POSED_SCORE, "the posed score, held by the game");
});
