// Carom — controls-solo/up: holding `ArrowUp` moves the human's paddle up.
//
// Solo is played on the left paddle, and the specification binds BOTH sides of
// the `dual-vertical` layout to it — `p1-up`/`p1-down` on `W`/`S` and
// `p2-up`/`p2-down` on the arrows all move the human's paddle, because Solo has
// no player two (specs/modes/single-player.md).
//
// The match is started from the title with real key events dispatched at the
// target the engine listens on, so the game stays under normal player control:
// nothing here calls a control operation, and the paddle moves only because the
// build read the action the engine raised from the key the case binds. The key is
// then held for a known span and the displacement read back off the game's own
// state, which is what makes this a check of the CONTROL rather than of the
// simulation.
//
// The direction is the whole point here, not the rate: how fast a held paddle
// travels is the `paddle-movement` category's, and asserting it in both places
// would cost one build two items for one fault.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MOVE_MIN,
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

it("moves the human's paddle up while ArrowUp is held, and stops on release", async () => {
  await startWithKeys(h, "solo");
  expect(["countdown", "playing"]).toContain(h.snapshot().screen);

  const moved = await holdMove(h, "left", "ArrowUp");
  expect(moved.delta).toBeLessThan(-MOVE_MIN);

  // A paddle is stationary unless a movement action is held
  // (specs/playfield.md), so releasing the key leaves it exactly where it
  // stopped rather than coasting on.
  const stopped = h.snapshot().paddles.left.cy;
  await h.advance(36);
  expect(h.snapshot().paddles.left.cy).toBeCloseTo(stopped, 6);
});
