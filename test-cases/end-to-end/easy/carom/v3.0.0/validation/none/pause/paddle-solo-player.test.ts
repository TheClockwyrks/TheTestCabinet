// Carom — pause/paddle-solo-player: while the game is paused, the human's
// paddle does not move, even with a movement key held.
//
// Pausing freezes the simulation, not just the ball: a paddle under a held key is
// as much a part of the frozen field as the ball in flight (specs/ui.md — "the
// field is visible but frozen behind the pause menu"). So this check holds the
// key on both sides of the pause. The same hold that moves the paddle in live
// play is repeated once the pause menu is up, and the second one must do nothing
// — which is what tells a build that stopped updating apart from one that merely
// stopped drawing the ball.
//
// THE PADDLES ARE THE PLAYER'S THROUGHOUT. `startPlaying` opens the match through
// the surface and drives nothing: `setPaddleDriven` is the only pose that takes a
// paddle, and this check makes none, so `KeyS` reaches the left paddle
// exactly as it does for a player. Nothing has to be walked through the menus
// to keep it that way.
//
// THE FIELD IS EMPTIED. What this point is about is a paddle and a key, so the
// ball and the obstacles come off: a ball left flying could reach a goal and end
// the point mid-check, and neither it nor an obstacle has anything to do with the
// reading. The paddles stay, because a paddle is field furniture the game always
// has.
//
// The pause itself is POSED, with `setScreen`. The key that opens the pause menu
// is `navigation/pause-escape`'s point and `ui/state-pause`'s; a build whose
// Escape did nothing should fail those rather than this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import {
  MOVE_MIN,
  captureReplay,
  clearField,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

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

afterEach(async () => {
  await h.dispose();
});

it("holds the human's paddle still while paused", async () => {
  await startPlaying(h, "solo");
  await clearField(h);
  const live = await h.snapshot();
  assertEqual(live.screen, "playing");

  // The precondition: this key really does move this paddle in live play, so the
  // freeze below is the pause's doing rather than a key that never worked.
  const start = live.paddles.left.cy;

  const held = await captureReplay(h, "frozen", async () => {
    await h.hold("KeyS");
    await h.advance(MOVING_TICKS);
    await h.release("KeyS");
    const moving = (await h.snapshot()).paddles.left.cy;

    await h.debug.setScreen("paused");
    const atPause = await h.snapshot();
    const screen = atPause.screen;
    const paused = atPause.paddles.left.cy;

    await h.hold("KeyS");
    await h.advance(FROZEN_TICKS);
    await h.release("KeyS");
    return { moving, screen, paused };
  });

  assertGreaterThan(Math.abs(held.moving - start), MOVE_MIN);
  assertEqual(held.screen, "paused");

  const after = await h.snapshot();
  assertEqual(after.screen, "paused");
  assertCloseTo(after.paddles.left.cy, held.paused, 6);
});
