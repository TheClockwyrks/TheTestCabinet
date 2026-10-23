// Carom — controls-versus/w: holding `KeyW` moves player one's left paddle up.
//
// Versus is two local players sharing the keyboard, and each movement action
// moves only its own player's paddle (specs/modes/versus.md): `W`/`S` are player
// one's on the left, the arrows are player two's on the right. So this check has
// two halves — the paddle the key owns moves, and the paddle it does not own
// stays where it was. The second half is what catches the common fault of a key
// driving both paddles at once, and both are read from the one hold.
//
// The match is opened through the debug surface, and the key that follows is a
// real one in the strongest sense: `hold`, `release` and `tap` press it through
// Chromium's own input pipeline, so what reaches the build is a browser-trusted
// DOM key event on the real page rather than a synthetic one posed at the event
// target a runtime listens on. The posed opening takes NEITHER paddle from the
// player — only `setPaddleDriven` does that, and nothing here calls it
// (specs/instrumentation.md) — so the game is under normal player control from
// the first frame and the paddle moves only because the build read the action its
// own runtime layer raised from the key the case binds. No menu key is pressed on
// the way in, which is the point of opening it this way: a build with a broken
// title menu and a working control fails the navigation checks and passes this
// one. That runtime layer is the build's own — `specs/instrumentation.md` puts
// the keyboard in the layer an engineless build supplies, and gives the surface
// no keyboard operation at all — so the whole path from a physical key to a
// moving paddle belongs to the build and every step of it is exercised, which
// makes this check stronger here rather than weaker. The key is then held for a
// known span and the displacement read back off the game's own state, which is
// what makes this a check of the CONTROL rather than of the simulation.
//
// THE FIELD IS EMPTIED FIRST. This point is about a key and a paddle, so the ball
// and the obstacles come off the field: nothing can arrive at a paddle mid-hold,
// and the clip a reviewer watches is the travel, the release, and the stop.
//
// The direction is the whole point here, not the rate: how fast a held paddle
// travels is the `paddle-movement` category's, and asserting it in both places
// would cost one build two items for one fault.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThan } from "../assert";
import {
  MOVE_MIN,
  STILL_MAX,
  captureReplay,
  clearField,
  createHarness,
  holdMove,
  startPlaying,
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
  await startPlaying(h, "versus");
  await clearField(h);
  assertEqual((await h.snapshot()).screen, "playing");

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

  assertLessThan(moved.delta, -MOVE_MIN);

  // The other player's paddle is not this key's to move.
  assertLessThan(Math.abs(moved.otherDelta.right), STILL_MAX);
  assertCloseTo((await h.snapshot()).paddles.left.cy, moved.stopped, 6);
});
