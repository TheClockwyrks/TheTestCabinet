// Carom — pause/paddle-versus-p1: while the game is paused, player one's paddle does not move, even with a
// movement key held.
//
// Pausing freezes the simulation, not just the ball: a paddle under a held key is
// as much a part of the frozen field as the ball in flight (specs/ui.md — "the
// field is visible but frozen behind the pause menu"). So this check holds the
// key on both sides of the pause. The same hold that moves the paddle in live
// play is repeated once the pause menu is up, and the second one must do nothing
// — which is what tells a build that stopped updating apart from one that merely
// stopped drawing the ball.
//
// Everything here goes through the keyboard: the match is started from the title
// with real key events, paused with one, and driven with one. No control
// operation is involved, so the paddle is under normal player control throughout.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MOVE_MIN,
  STILL_MAX,
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";

/** Past the 1.0 s pre-serve hold and into a live rally: 1.3 s at 120 Hz. */
const RALLY_TICKS = 156;

/**
 * The frames of live movement recorded before the pause, and the frozen ones
 * after it.
 *
 * A clip of a still paddle is not evidence of anything on its own — it is
 * indistinguishable from a build whose paddle never moved. What makes it evidence
 * is the motion it is cut from: the same paddle, under the same key, moving in
 * live play and then not moving once the game is paused, in one recording.
 *
 * That precondition was always driven; arming the recorder before it rather than
 * after moves nothing. Every reading below is still taken on exactly the frame it
 * was taken on before — they are lifted out of the recorded section as values so
 * the assertions can stay outside it.
 */
const MOVING_TICKS = 12; // 0.1 s of live travel
const FROZEN_TICKS = 96; // 0.8 s of the key held against a paused game

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds player one's paddle still while paused", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");

  // The precondition: this key really does move this paddle in live play, so the
  // freeze below is the pause's doing rather than a key that never worked.
  const start = h.snapshot().paddles.left.cy;

  const held = await captureReplay(h, "frozen", async () => {
    h.hold("KeyS");
    await h.advance(MOVING_TICKS);
    h.release("KeyS");
    const moving = h.snapshot().paddles.left.cy;

    await h.tap("Escape");
    const screen = h.snapshot().screen;
    const paused = h.snapshot().paddles.left.cy;

    h.hold("KeyS");
    await h.advance(FROZEN_TICKS);
    h.release("KeyS");
    return { moving, screen, paused };
  });

  expect(Math.abs(held.moving - start)).toBeGreaterThan(MOVE_MIN);
  expect(held.screen).toBe("paused");

  expect(h.snapshot().screen).toBe("paused");
  expect(Math.abs(h.snapshot().paddles.left.cy - held.paused)).toBeLessThan(
    STILL_MAX,
  );
});
