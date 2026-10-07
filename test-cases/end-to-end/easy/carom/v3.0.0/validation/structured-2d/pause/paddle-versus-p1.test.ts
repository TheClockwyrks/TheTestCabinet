// Carom — pause/paddle-versus-p1: while the game is paused, player one's paddle
// does not move, even with a movement key held.
//
// Pausing freezes the simulation, not just the ball: a paddle under a held key is
// as much a part of the frozen field as the ball in flight (specs/ui.md — "the
// field is visible but frozen behind the pause menu"). So this check holds the
// key on both sides of the pause. The same hold that moves the paddle in live
// play is repeated once the pause menu is up, and the second one must do nothing
// — which is what tells a build that stopped updating apart from one that merely
// stopped drawing the ball.
//
// THE PADDLE IS THE PLAYER'S THROUGHOUT. Live play is posed rather than played
// into: the countdown is opened, the field is CLEARED, and `playing` is posed
// over it. No operation here touches `setPaddleDriven`, and none of the poses
// that reach this screen does either, so the left paddle answers the keyboard
// exactly as it does for a player — which is the whole of what this check is
// about, and which only the surface's atomic operations make possible.
//
// THE FIELD IS EMPTY. This point concerns a paddle and the pause, so no ball and
// no obstacle is on the field: an absent ball takes no part in a frame
// (specs/instrumentation.md), so nothing but the pause can hold this paddle
// still, and nothing on the field can score a point and move the screen out from
// under the reading.
//
// MOVE_MIN is the suite's non-trivial displacement. At PADDLE_SPEED the 12-frame
// hold below travels 72 units, so a build moving the paddle the right way clears
// it comfortably and one that did not move it never does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  MOVE_MIN,
  captureReplay,
  clearField,
  createHarness,
  openCountdown,
  type Harness,
} from "../harness";

/**
 * The frames of live movement recorded before the pause, and the frozen ones
 * after it.
 *
 * A clip of a still paddle is not evidence of anything on its own — it is
 * indistinguishable from a build whose paddle never moved. What makes it evidence
 * is the motion it is cut from: the same paddle, under the same key, moving in
 * live play and then not moving once the game is paused, in one recording. Every
 * reading is lifted out of the recorded section as a value so the assertions can
 * stay outside it.
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
  await openCountdown(h, "versus");
  clearField(h);
  h.debug.setScreen("playing");
  await h.advance(1);
  assertEqual(h.snapshot().screen, "playing");

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

  assertGreaterThan(Math.abs(held.moving - start), MOVE_MIN);
  assertEqual(held.screen, "paused");

  assertEqual(h.snapshot().screen, "paused");
  // "Nothing advances" while paused (specs/ui.md): the center is exactly where
  // the pause left it.
  assertEqual(h.snapshot().paddles.left.cy, held.paused);
});
