// Carom — pause/paddle-solo-ai: while the game is paused, the AI's paddle does
// not move, even with a ball to chase.
//
// The AI is part of the simulation, so pausing must stop it exactly as it stops a
// held key and the ball. This poses the one situation in which a frozen AI and a
// running one look different — a ball crossing the field toward it, far from
// where its paddle is — and leaves the right paddle with the REAL opponent:
// `placePaddle` sets a centre and takes nothing, so what freezes is the build's
// own AI rather than a driven paddle's held velocity.
//
// Both of the AI's faculties are on. They are gated separately now
// (specs/instrumentation.md) — `setAiTracking` for what it senses,
// `setAiMovement` for whether its paddle travels — and this point is about the
// whole opponent standing still, so it gives it both and watches it play.
//
// The field holds the ball the AI is chasing and nothing else. `arrangeAiChase`
// empties it with `clearWorld` and spawns back that one ball, so both obstacles
// are gone rather than dodged and nothing can deflect the approach the AI is
// reacting to. The human's paddle is the field furniture no operation removes, so
// it is DRIVEN out of the lane instead — the exception specs/instrumentation.md
// names.
//
// The pause is POSED rather than pressed. `setScreen("paused")` puts the game on
// the screen and touches nothing else, which is the precondition this point
// names; whether a key opens the pause menu is the controls category's point.
//
// The chase is watched running first. Without that, a build whose AI never moved
// at all would pass the freeze for the wrong reason. The frozen stretch is held
// to exact equality, because "nothing advances" admits no drift.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeAiChase,
  captureReplay,
  createHarness,
  openPause,
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
  arrangeAiChase(h, { paddleCy: 200, ballY: 620 });

  // The precondition: the right paddle is still the AI's, and the real opponent
  // is chasing, so a still paddle later is the pause's doing.
  const opened = h.snapshot();
  assertEqual(opened.paddles.right.driven, false);
  assertEqual(opened.ai.tracking, true);
  assertEqual(opened.ai.movement, true);
  const start = opened.paddles.right.cy;

  const held = await captureReplay(h, "frozen", async () => {
    await h.advance(CHASING_TICKS);
    const chasing = h.snapshot().paddles.right.cy;

    openPause(h, "playing");
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
