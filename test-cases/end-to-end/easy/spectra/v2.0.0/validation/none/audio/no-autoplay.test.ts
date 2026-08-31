// audio/no-autoplay — nothing sounds between the page loading and the first key.
//
// `specs/ui.md`: "No sound is started between the page loading and the player's
// first key press, and a build whose audio cannot start still runs and still
// plays."
//
// So the measurement is: load the build, let it run — both under the suite's own
// clock and under the build's own frame loop in real time — and read the raw
// source count without ever pressing a key. `validation/audio-init.js` is
// injected before any of the build's script runs and counts what goes through the
// two doors a browser can emit sound through, so a build that starts an
// oscillator or plays an `<audio>` element while it initializes is caught even
// though the browser's own autoplay policy would have kept it inaudible.
//
// NO KEY IS PRESSED ANYWHERE IN THIS CHECK, and that is the whole scenario. In
// particular `armAudio` is NOT called here, though every other check in this
// directory opens with it: arming presses a real key, which is exactly the event
// this check must stay on the near side of. Nothing below reaches for a bound key
// either.
//
// WHY BOTH CLOCKS. The suite drives the game frame by frame through the debug
// surface, which is not how a loaded page runs on its own; a build that made a
// sound from its own `requestAnimationFrame` loop and nowhere else would sit
// silent under a driven clock. So the page is also handed back to its own frame
// loop for a stretch of real time, and the count is read after both.
//
// WHAT THIS DOES NOT DECIDE. That the build makes any sound at all once a key HAS
// been pressed, which is what the nine cue points above decide, and what a build
// silent for a different reason fails there rather than here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  type Harness,
} from "../harness";

/**
 * Frames of the loaded game driven under the suite's clock.
 *
 * A whole second of the screen the game opens on, which is long enough for any
 * per-frame or timed sound a build might start to have started.
 */
const IDLE_FRAMES = framesFor(1);

/**
 * Milliseconds the page is handed back to its OWN frame loop, in real time.
 *
 * Enough for a sixty-hertz loop to run some two dozen frames of its own, so a
 * build that sounds from `requestAnimationFrame` rather than from a driven
 * `advance` is read as well.
 */
const IDLE_MS = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts no sound before the player's first key press", async () => {
  // The game as the page left it: whatever screen the build opens on, with no key
  // ever delivered to it.
  const opened = await h.snapshot();

  // A second of it under the suite's clock, then a stretch under the build's own.
  await h.advance(IDLE_FRAMES);
  await h.runFor(IDLE_MS);

  const started = await h.sounds();
  await captureStill(h, "loaded");

  assertEqual(
    started,
    0,
    "sounds the build started between the page loading and the first key — " +
      `over ${String(IDLE_FRAMES)} driven frames and ${String(IDLE_MS)} ms of ` +
      `the build's own loop on the ${opened.screen} screen, with no key ever ` +
      "pressed (specs/ui.md)",
  );
});
