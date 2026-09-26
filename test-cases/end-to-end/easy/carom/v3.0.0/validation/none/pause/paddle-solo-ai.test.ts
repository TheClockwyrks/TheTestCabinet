// Carom — pause/paddle-solo-ai: while the game is paused, the AI's paddle does
// not move, even with a ball to chase.
//
// The AI is part of the simulation, so pausing must stop it exactly as it stops a
// held key and the ball. This poses the one situation in which a frozen AI and a
// running one look different — a ball crossing the field toward it, far from
// where its paddle is.
//
// THE AI IS THE REAL ONE, AND ITS PADDLE IS ITS OWN. `arrangeAiChase` gives the
// opponent both of its faculties (`setAiTracking` and `setAiMovement`) and takes
// neither paddle: the AI moves the right paddle only while that paddle is the
// AI's, so what is frozen below is the build's own opponent rather than a driven
// paddle standing still because its `drivenVy` is zero.
//
// THE FIELD HOLDS THE ONE BALL THE AI IS CHASING. `arrangeAiChase` empties it and
// spawns that ball back, so both obstacles are off it: the chase this point
// watches is the AI against one shot, and that is also what the replay shows.
//
// The pause itself is POSED, with `setScreen`. The key that opens the pause menu
// is `navigation/pause-escape`'s point and `ui/state-pause`'s; a build whose
// Escape did nothing should fail those rather than this one.
//
// The chase is watched running first. Without that, a build whose AI never moved
// at all would pass the freeze for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  STILL_MAX,
  arrangeAiChase,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

/**
 * The frames of live chasing recorded before the pause, and the frozen ones
 * after it.
 *
 * A clip of a still paddle is not evidence of anything on its own — it is
 * indistinguishable from a build whose AI never moved. What makes it evidence is
 * the chase it is cut from: the same paddle, with the same ball to run down,
 * tracking in live play and then not tracking once the game is paused, in one
 * recording.
 *
 * That precondition was always driven; arming the recorder before it rather than
 * after moves nothing, and every reading below is still taken on exactly the
 * frame it was taken on before.
 */
const CHASING_TICKS = 36; // 0.3 s of the real opponent tracking
const FROZEN_TICKS = 120; // 1.0 s of a paused game with a ball to chase

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the AI paddle still while paused", async () => {
  await arrangeAiChase(h, { paddleCy: 200, ballY: 620 });

  // The precondition: the real opponent is chasing, so a still paddle later is
  // the pause's doing.
  const start = (await h.snapshot()).paddles.right.cy;

  const held = await captureReplay(h, "frozen", async () => {
    await h.advance(CHASING_TICKS);
    const chasing = (await h.snapshot()).paddles.right.cy;

    await h.debug.setScreen("paused");
    const atPause = await h.snapshot();
    const screen = atPause.screen;
    const paused = atPause.paddles.right.cy;

    await h.advance(FROZEN_TICKS);
    return { chasing, screen, paused };
  });

  assertGreaterThan(Math.abs(held.chasing - start), STILL_MAX);
  assertEqual(held.screen, "paused");

  const after = await h.snapshot();
  assertEqual(after.screen, "paused");
  assertCloseTo(after.paddles.right.cy, held.paused, 6);
});
