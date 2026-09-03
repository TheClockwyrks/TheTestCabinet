// Carom — pause/paddle-solo-ai: while the game is paused, the AI's paddle does
// not move, even with a ball to chase.
//
// The AI is part of the simulation, so pausing must stop it exactly as it stops a
// held key and the ball. This poses the one situation in which a frozen AI and a
// running one look different — a ball crossing the field toward it, far from
// where its paddle is — over a field holding that ball and nothing else: both
// obstacles are off it, so nothing can deflect the chase into something the AI
// was not chasing.
//
// WHAT IS FROZEN IS THE BUILD'S OWN OPPONENT. The right paddle is handed back
// with `setPaddleDriven("right", false)` and both of the AI's faculties are left
// where `reset` put them — `tracking` and `movement` both on — so the paddle is
// moved by the rule specs/modes/single-player.md states rather than by a
// `drivenVy` the surface set. The left paddle is the one piece of furniture no
// operation removes, so it is held out of the way at PARKED_CY.
//
// The chase is watched running first. Without that, a build whose AI never moved
// at all would pass the freeze for the wrong reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
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

afterEach(() => {
  h?.dispose();
});

it("holds the AI paddle still while paused", async () => {
  await arrangeAiChase(h, { paddleCy: 200, ballY: 620 });
  assertEqual(h.snapshot().paddles.right.driven, false);
  assertDeepEqual(h.snapshot().ai, { tracking: true, movement: true });

  // The precondition: the real opponent is chasing, so a still paddle later is
  // the pause's doing.
  const start = h.snapshot().paddles.right.cy;

  const held = await captureReplay(h, "frozen", async () => {
    await h.advance(CHASING_TICKS);
    const chasing = h.snapshot().paddles.right.cy;

    await h.tap("Escape");
    const screen = h.snapshot().screen;
    const paused = h.snapshot().paddles.right.cy;

    await h.advance(FROZEN_TICKS);
    return { chasing, screen, paused };
  });

  assertGreaterThan(Math.abs(held.chasing - start), 0);
  assertEqual(held.screen, "paused");

  assertEqual(h.snapshot().screen, "paused");
  // "Nothing advances" while paused (specs/ui.md): the center is exactly where
  // the pause left it.
  assertEqual(h.snapshot().paddles.right.cy, held.paused);
});
