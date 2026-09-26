// Carom — controls-versus/down: holding `ArrowDown` moves player two's right paddle down.
//
// Versus is two local players sharing the keyboard, and each movement action
// moves only its own player's paddle (specs/modes/versus.md): `W`/`S` are player
// one's on the left, the arrows are player two's on the right. So this check has
// two halves — the paddle the key owns moves, and the paddle it does not own
// stays where it was. The second half is what catches the common fault of a key
// driving both paddles at once, and both are read from the one hold.
//
// The countdown is posed through the debug surface — the menus are the navigation
// checks' surface, not this one's — and NOTHING takes a paddle, so the game stays
// under normal player control: no operation here touches a paddle, and it moves
// only because the build read the action the runtime raised from the key the case
// binds, dispatched as a real event at the target the runtime listens on.
//
// THE FIELD IS EMPTY. Which paddle a key moves, and which way, is about the
// paddles alone, so the ball and the obstacles come off the field: nothing else
// is moving while the key is held, and with no ball there is no hold to elapse,
// so the countdown cannot turn over partway through the span. It is also what
// makes the second half exact — the paddle the key does not own has nothing on
// the field that could nudge it, so its displacement is zero rather than small.
//
// The direction is the whole point here, not the rate: how fast a held paddle
// travels is the `paddle-movement` category's, and asserting it in both places
// would cost one build two items for one fault.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertContains,
  assertEqual,
  assertGreaterThan,
} from "../assert";
import {
  MOVE_MIN,
  captureReplay,
  clearField,
  createHarness,
  holdMove,
  openCountdown,
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
  h?.dispose();
});

it("moves player two's right paddle down while ArrowDown is held, and stops on release", async () => {
  await openCountdown(h, "versus");
  clearField(h);
  assertContains(["countdown", "playing"], h.snapshot().screen);

  const moved = await captureReplay(h, "move", async () => {
    await h.advance(REST_TICKS);
    const held = await holdMove(h, "right", "ArrowDown");

    // A paddle is stationary unless a movement action is held
    // (specs/playfield.md), so releasing the key leaves it exactly where it
    // stopped rather than coasting on.
    const stopped = h.snapshot().paddles.right.cy;
    await h.advance(COAST_TICKS);
    return { ...held, stopped };
  });

  assertGreaterThan(moved.delta, MOVE_MIN);

  // The other player's paddle is not this key's to move.
  assertEqual(moved.otherDelta.left, 0);
  assertCloseTo(h.snapshot().paddles.right.cy, moved.stopped, 6);
});
