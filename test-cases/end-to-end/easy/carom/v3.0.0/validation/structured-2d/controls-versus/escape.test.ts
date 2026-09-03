// Carom — controls-versus/escape: pressing `Esc` during a Versus match pauses it.
//
// `Escape` is bound to the runtime's `pause` action (specs/modes/versus.md).
//
// `Escape` deliberately drives TWO actions — `pause` and `back` — and the game
// reads whichever the screen calls for, so a real `Escape` key event raises both
// edges at once and a live match must resolve it as the pause. Dispatching the
// key rather than the action is what puts that ambiguity in front of the build,
// which is the whole of what this item is about.
//
// The match is opened through the debug surface and run up to live play — past
// the pre-serve hold, so what is paused is a match in flight rather than its
// countdown, which is the `gameplay/pause-during-countdown` item's separate
// point. The menus are the navigation checks' surface, not this item's: a build
// with a broken menu and a working pause must fail those checks, not this one.
// The posed opening takes NOTHING from the player — not a paddle, not a key — so
// the pause key reaches the build over the same path it reaches it over for a
// player. The key event is dispatched at the target the runtime listens on, so
// the action is raised by the binding the case declares rather than by anything
// this check reaches into.
//
// THE FIELD HOLDS THE ONE BALL AND NOTHING ELSE. What is paused is a match in
// motion, and the ball in flight is what the motion is; the obstacles come off,
// since a frozen obstacle is no part of what a pause key does. Both paddles stay
// with whoever plays them, which in a match nobody is playing means standing
// still where the match start put them.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openIsolatedPlay,
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

it("pauses a live Versus match when Escape is pressed", async () => {
  await openIsolatedPlay(h, { mode: "versus" });

  await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    assertEqual(h.snapshot().screen, "playing");

    await h.tap("Escape");
    assertEqual(h.snapshot().screen, "paused");

    // And it stays paused: the press opened a screen, it did not blink one.
    await h.advance(PAUSED_TICKS);
  });
  assertEqual(h.snapshot().screen, "paused");
});
