// Carom — controls-versus/w: holding `KeyW` moves player one's left paddle up.
//
// Versus is two local players sharing the keyboard, and each movement action
// moves only its own player's paddle (specs/modes/versus.md): `W`/`S` are player
// one's on the left, the arrows are player two's on the right. So this check has
// two halves — the paddle the key owns moves, and the paddle it does not own
// stays where it was. The second half is what catches the common fault of a key
// driving both paddles at once, and both are read from the one hold.
//
// The match is started from the title with real key presses, and here they are
// real in the strongest sense: `hold`, `release` and `tap` press the key
// through Chromium's own input pipeline, so what reaches the build is a
// browser-trusted DOM key event on the real page rather than a synthetic one
// posed at the event target a runtime listens on. The game stays under normal
// player control: nothing here calls a control operation, and the paddle moves
// only because the build read the action its own runtime layer raised from the
// key the case binds. That layer is the build's own —
// `specs/instrumentation.md` puts the keyboard in the runtime layer an
// engineless build supplies, and gives the surface no keyboard operation at
// all — so the whole path from a physical key to a moving paddle belongs to the
// build and every step of it is exercised, which makes this check stronger here
// rather than weaker.
//
// The direction is the whole point here, not the rate: how fast a held paddle
// travels is the `paddle-movement` category's, and asserting it in both places
// would cost one build two items for one fault.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  MOVE_MIN,
  STILL_MAX,
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

afterEach(async () => {
  await h.dispose();
});

it("moves player one's left paddle up while KeyW is held, and stops on release", async () => {
  await startWithKeys(h, "versus");
  expect(["countdown", "playing"]).toContain((await h.snapshot()).screen);

  const moved = await captureReplay(h, "move", async () => {
    await h.advance(REST_TICKS);
    const held = await holdMove(h, "left", "KeyW");

    // A paddle is stationary unless a movement action is held
    // (specs/playfield.md), so releasing the key leaves it exactly where it
    // stopped rather than coasting on.
    const stopped = (await h.snapshot()).paddles.left.cy;
    await h.advance(COAST_TICKS);
    return { ...held, stopped };
  });

  expect(moved.delta).toBeLessThan(-MOVE_MIN);

  // The other player's paddle is not this key's to move.
  expect(Math.abs(moved.otherDelta.right)).toBeLessThan(STILL_MAX);
  expect((await h.snapshot()).paddles.left.cy).toBeCloseTo(moved.stopped, 6);
});
