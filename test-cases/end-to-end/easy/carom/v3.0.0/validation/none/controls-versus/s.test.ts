// Carom — controls-versus/s: holding `KeyS` moves player one's left paddle down.
//
// Versus is two local players sharing the keyboard, and each movement action
// moves only its own player's paddle (specs/modes/versus.md): `W`/`S` are player
// one's on the left, the arrows are player two's on the right. So this check has
// two halves — the paddle the key owns moves, and the paddle it does not own
// stays where it was. The second half is what catches the common fault of a key
// driving both paddles at once, and both are read from the one hold.
//
// The match is started from the title with real key events dispatched at the
// target the runtime listens on, so the game stays under normal player control:
// nothing here calls a control operation, and the paddle moves only because the
// build read the action the runtime raised from the key the case binds.
//
// The direction is the whole point here, not the rate: how fast a held paddle
// travels is the `paddle-movement` category's, and asserting it in both places
// would cost one build two items for one fault.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MOVE_MIN,
  STILL_MAX,
  createHarness,
  holdMove,
  startWithKeys,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves player one's left paddle down while KeyS is held, and stops on release", async () => {
  await startWithKeys(h, "versus");
  expect(["countdown", "playing"]).toContain(h.snapshot().screen);

  const moved = await holdMove(h, "left", "KeyS");
  expect(moved.delta).toBeGreaterThan(MOVE_MIN);

  // The other player's paddle is not this key's to move.
  expect(Math.abs(moved.otherDelta.right)).toBeLessThan(STILL_MAX);

  // A paddle is stationary unless a movement action is held
  // (specs/playfield.md), so releasing the key leaves it exactly where it
  // stopped rather than coasting on.
  const stopped = h.snapshot().paddles.left.cy;
  await h.advance(36);
  expect(h.snapshot().paddles.left.cy).toBeCloseTo(stopped, 6);
});
