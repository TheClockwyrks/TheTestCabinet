// Carom — pause/paddle-solo-player: while the game is paused, the human's paddle
// does not move, even with a movement key held.
//
// Pausing freezes the simulation, not just the ball: a paddle under a held key is
// as much a part of the frozen field as the ball in flight (specs/ui.md — nothing
// advances on `paused`, and the field is visible and frozen behind the menu). So
// this check holds the key on BOTH sides of the pause. The same hold that moves
// the paddle in live play is repeated once the pause menu is up, and the second
// one must do nothing — which is what tells a build that stopped updating apart
// from one that merely stopped drawing, and apart from one whose key never
// worked at all.
//
// The paddle stays the PLAYER's throughout. `enterPlaying` opens a solo match on
// `playing` and takes nothing from anyone — no operation here drives a paddle —
// so the key moves the paddle exactly as it moves it for a player. That is the
// whole point of taking a paddle one side at a time, and it is why this check no
// longer has to walk the title menu to find a match nothing had seized.
//
// The field is emptied. This point is about a paddle under a key, so it concerns
// no ball and no obstacle, and a ball left standing could score during the live
// stretch and put the game on a screen this reading was never about. The paddles
// are the field furniture no operation removes, and neither of them is parked
// here: the one under test has to be free to move, and the other is not read.
//
// The pause is POSED rather than pressed. `setScreen("paused")` puts the game on
// the screen and touches nothing else, which is the precondition this point
// names; whether a key opens the pause menu is the controls category's point.
//
// MOVE_MIN is the live stretch's bound: at PADDLE_SPEED the 12-frame hold travels
// 72 units, which clears it several times over and which no build that failed to
// move the paddle reaches. The frozen stretch is held to exact equality, because
// "nothing advances" admits no drift.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  MOVE_MIN,
  captureReplay,
  createHarness,
  enterPlaying,
  openPause,
  poseWorld,
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

/** The key this control context moves the paddle with (specs/ui.md). */
const KEY = "KeyS";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the human's paddle still while paused", async () => {
  enterPlaying(h, "solo");
  poseWorld(h, { balls: [], obstacles: [] });
  assertEqual(h.snapshot().screen, "playing");
  assertEqual(h.snapshot().paddles.left.driven, false);

  // The precondition: this key really does move this paddle in live play, so the
  // freeze below is the pause's doing rather than a key that never worked.
  const start = h.snapshot().paddles.left.cy;

  const held = await captureReplay(h, "frozen", async () => {
    h.hold(KEY);
    await h.advance(MOVING_TICKS);
    h.release(KEY);
    const moving = h.snapshot().paddles.left.cy;

    openPause(h, "playing");
    const screen = h.snapshot().screen;
    const paused = h.snapshot().paddles.left.cy;

    h.hold(KEY);
    await h.advance(FROZEN_TICKS);
    h.release(KEY);
    return { moving, screen, paused };
  });

  assertGreaterThan(Math.abs(held.moving - start), MOVE_MIN);
  assertEqual(held.screen, "paused");

  assertEqual(h.snapshot().screen, "paused");
  // "Nothing advances" while paused (specs/ui.md): the center is exactly where
  // the pause left it.
  assertEqual(h.snapshot().paddles.left.cy, held.paused);
});
