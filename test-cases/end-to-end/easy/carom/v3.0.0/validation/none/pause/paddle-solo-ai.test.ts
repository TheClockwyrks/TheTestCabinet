// Carom — pause/paddle-solo-ai: while the game is paused, the AI's paddle does
// not move, even with a ball to chase.
//
// The AI is part of the simulation, so pausing must stop it exactly as it stops a
// held key and the ball. This poses the one situation in which a frozen AI and a
// running one look different — a ball crossing the field toward it, far from
// where its paddle is — and hands the right paddle back to the real opponent with
// `setAiControl`, so what is frozen is the build's own AI rather than a driver's
// held velocity.
//
// The chase is watched running first. Without that, a build whose AI never moved
// at all would pass the freeze for the wrong reason.

import { afterEach, beforeEach, expect, it } from "vitest";
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

    await h.tap("Escape");
    const atPause = await h.snapshot();
    const screen = atPause.screen;
    const paused = atPause.paddles.right.cy;

    await h.advance(FROZEN_TICKS);
    return { chasing, screen, paused };
  });

  expect(Math.abs(held.chasing - start)).toBeGreaterThan(STILL_MAX);
  expect(held.screen).toBe("paused");

  const after = await h.snapshot();
  expect(after.screen).toBe("paused");
  expect(after.paddles.right.cy).toBeCloseTo(held.paused, 6);
});
