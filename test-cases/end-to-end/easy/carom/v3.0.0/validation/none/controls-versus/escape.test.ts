// Carom — controls-versus/escape: pressing `Esc` during a Versus match pauses it.
//
// `Escape` is bound to the runtime's `pause` action (specs/modes/versus.md).
//
// `Escape` deliberately drives TWO actions — `pause` and `back` — and the game
// reads whichever the screen calls for, so a real `Escape` key event raises both
// edges at once and a live match must resolve it as the pause. Pressing the key
// rather than raising the action is what puts that ambiguity in front of the
// build, which is the whole of what this item is about.
//
// The match is opened through the debug surface and run up to live play — past
// the pre-serve hold, so what is paused is a match in flight rather than its
// countdown, which is the `gameplay/pause-during-countdown` item's separate
// point. The menus are the navigation checks' surface, not this item's: a build
// with a broken menu and a working pause must fail those checks, not this one.
// The posed opening hands only the PADDLES to the debug driver, so the pause
// key still reaches the build. The key is pressed through Chromium's own input
// pipeline, so what reaches the build is a browser-trusted DOM key event on the
// real page rather than a synthetic one posed at the event target a runtime
// listens on, and the action is raised by the binding the case declares rather
// than by anything this check reaches into. The keyboard that reads it is the
// build's own — `specs/instrumentation.md` puts it in the runtime layer an
// engineless build supplies, and gives the surface no keyboard operation at
// all — so the whole path from a physical key to a paused match is exercised,
// which makes this check stronger here rather than weaker.

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

afterEach(async () => {
  await h.dispose();
});

it("pauses a live Versus match when Escape is pressed", async () => {
  await startPlaying(h, "versus");

  await captureReplay(h, "pause", async () => {
    await h.advance(LIVE_TICKS);
    assertEqual((await h.snapshot()).screen, "playing");

    await h.tap("Escape");
    assertEqual((await h.snapshot()).screen, "paused");

    // And it stays paused: the press opened a screen, it did not blink one.
    await h.advance(PAUSED_TICKS);
  });
  assertEqual((await h.snapshot()).screen, "paused");
});
