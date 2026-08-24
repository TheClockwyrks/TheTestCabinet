// Carom — controls-versus/p: pressing `P` during a Versus match pauses it.
//
// `KeyP` is bound to the runtime's `pause` action (specs/modes/versus.md).
//
// The match is started from the title with real key events and then played into a
// live rally — past the pre-serve hold, so what is paused is a match in flight
// rather than its countdown, which is the `gameplay/pause-during-countdown`
// item's separate point. The key event is dispatched at the target the runtime
// listens on, so the action is raised by the binding the case declares rather
// than by anything this check reaches into.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startWithKeys,
  type Harness,
} from "../harness";

/** Past the 1.0 s pre-serve hold and into a live rally: 1.3 s at 120 Hz. */
const RALLY_TICKS = 156;

/**
 * The last stretch of the rally, recorded, and the stretch before it that is not.
 *
 * `RALLY_TICKS` frames still pass before the key is pressed — the split is only
 * where the recorder is armed, and nothing about the match's timeline moves. What
 * it buys is a clip that opens on a match IN MOTION: this point is about the
 * transition into the pause, and a recording that began at the key press would
 * hold nothing but the screen it ended on.
 */
const LIVE_TICKS = 48; // 0.4 s

/** Frames held after the press, long enough that a blink would show. */
const PAUSED_TICKS = 84; // 0.7 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pauses a live Versus match when KeyP is pressed", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS - LIVE_TICKS);

  await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    assertEqual(h.snapshot().screen, "playing");

    await h.tap("KeyP");
    assertEqual(h.snapshot().screen, "paused");

    // And it stays paused: the press opened a screen, it did not blink one.
    await h.advance(PAUSED_TICKS);
  });
  assertEqual(h.snapshot().screen, "paused");
});
