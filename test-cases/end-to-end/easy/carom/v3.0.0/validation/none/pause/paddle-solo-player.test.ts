// Carom — pause/paddle-solo-player: while the game is paused, the human's paddle does not move, even with a
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
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";

/** Past the 1.0 s pre-serve hold and into a live rally: 1.3 s at 120 Hz. */
const RALLY_TICKS = 156;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the human's paddle still while paused", async () => {
  await startWithKeys(h, "solo");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");

  // The precondition: this key really does move this paddle in live play, so the
  // freeze below is the pause's doing rather than a key that never worked.
  const start = h.snapshot().paddles.left.cy;
  h.hold("KeyS");
  await h.advance(12);
  h.release("KeyS");
  expect(Math.abs(h.snapshot().paddles.left.cy - start)).toBeGreaterThan(
    MOVE_MIN,
  );

  await h.tap("Escape");
  expect(h.snapshot().screen).toBe("paused");

  const paused = h.snapshot().paddles.left.cy;
  h.hold("KeyS");
  await h.advance(96);
  h.release("KeyS");

  expect(h.snapshot().screen).toBe("paused");
  expect(Math.abs(h.snapshot().paddles.left.cy - paused)).toBeLessThan(
    STILL_MAX,
  );
});
