// Carom — controls-solo/s: holding `KeyS` moves the human's paddle down.
//
// Solo is played on the left paddle, and the specification binds BOTH sides of
// the `dual-vertical` layout to it — `p1-up`/`p1-down` on `W`/`S` and
// `p2-up`/`p2-down` on the arrows all move the human's paddle, because Solo has
// no player two (specs/modes/single-player.md).
//
// The match is started from the title with real key events dispatched at the
// target the runtime listens on, so the game stays under normal player control:
// nothing here calls a control operation, and the paddle moves only because the
// build read the action the runtime raised from the key the case binds. The key is
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
  captureReplay,
  createHarness,
  holdMove,
  startWithKeys,
  type Harness,
} from "../harness";

/**
 * Frames recorded either side of the held span.
 *
 * The hold itself is short — a third of a second — and on its own it records as a
 * paddle that was already moving when the clip opened and still moving when it
 * ended. The two stretches here are what make it read as a control: the paddle at
 * rest before the key goes down, and the paddle at rest after it comes up.
 *
 * The coast was always driven; all that changed is that it is now driven INSIDE
 * the recorded section, because "and stops on release" is half of what this point
 * promises a reviewer and it is only legible beside the travel it followed.
 * Nothing measured moves: `holdMove` takes its own readings across the hold
 * alone, and the position the coast is checked against is still the one read on
 * the frame the key came up.
 */
const REST_TICKS = 24; // 0.2 s at rest before the key goes down
const COAST_TICKS = 36; // 0.3 s with nothing held after it comes up

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the human's paddle down while KeyS is held, and stops on release", async () => {
  await startWithKeys(h, "solo");
  expect(["countdown", "playing"]).toContain(h.snapshot().screen);

  const moved = await captureReplay(h, "move", async () => {
    await h.advance(REST_TICKS);
    const held = await holdMove(h, "left", "KeyS");

    // A paddle is stationary unless a movement action is held
    // (specs/playfield.md), so releasing the key leaves it exactly where it
    // stopped rather than coasting on.
    const stopped = h.snapshot().paddles.left.cy;
    await h.advance(COAST_TICKS);
    return { ...held, stopped };
  });

  expect(moved.delta).toBeGreaterThan(MOVE_MIN);
  expect(h.snapshot().paddles.left.cy).toBeCloseTo(moved.stopped, 6);
});
