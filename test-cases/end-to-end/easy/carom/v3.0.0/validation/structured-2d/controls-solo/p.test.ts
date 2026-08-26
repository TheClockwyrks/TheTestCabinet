// Carom — controls-solo/p: pressing `P` during a Solo match pauses it.
//
// `KeyP` is bound to the runtime's `pause` action (specs/modes/single-player.md).
//
// The match is opened through the debug surface and run up to live play — past
// the pre-serve hold, so what is paused is a match in flight rather than its
// countdown, which is the `gameplay/pause-during-countdown` item's separate
// point. The menus are the navigation checks' surface, not this item's: a build
// with a broken menu and a working pause must fail those checks, not this one.
// The posed opening hands only the PADDLES to the debug driver, so the pause
// key still reaches the build. The key event is dispatched at the target the
// runtime listens on, so the action is raised by the binding the case declares
// rather than by anything this check reaches into.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/**
 * The stretch of live rally recorded before the key goes down.
 *
 * The clip opens on a match IN MOTION: this point is about the transition into
 * the pause, and a recording that began at the key press would hold nothing but
 * the screen it ended on.
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

it("pauses a live Solo match when KeyP is pressed", async () => {
  await startPlaying(h, "solo");

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
