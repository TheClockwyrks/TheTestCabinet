// audio/no-autoplay — nothing sounds between the page loading and the first key.
//
// `specs/ui.md`: "No sound is started between the page loading and the player's
// first key press: the game plays no cue before that first input."
//
// So the measurement is: build the game as a loaded page does, let it run without
// ever delivering a key, and read the engine's cue bus. The bus announces a play
// whether or not it is unlocked (`audio:unlocked` is the engine's own affair), so
// a build that plays a cue while it initializes is caught here even though the
// browser's autoplay policy would have kept it inaudible.
//
// NO KEY IS PRESSED ANYWHERE IN THIS CHECK, and that is the whole scenario.
// Nothing is posed either: `startPosed` would be a scenario the loaded page never
// reaches, and the screen the build opens on is exactly the one the requirement is
// about.
//
// THE READING STARTS BEFORE THE BUILD DOES. `harness.ts` subscribes to
// `cue:played` before it calls `engine.initialize()`, so `h.cues` holds every cue
// the build played from its very first line — its instance's `initialize`, the
// level's `load`, the first frame — not merely from the first driven frame. That
// is what makes "the page loading" the near edge of the window rather than "the
// harness was ready".
//
// BOTH DOORS ARE WATCHED. The bus starts a sound two ways: `play` sounds a cue
// once, `loop` sets one running. A build that opened a looping drone at load would
// be making sound while announcing no play, so the loops are counted as well —
// from the moment the harness hands the game back, which is the earliest a
// validator can subscribe to them.
//
// BOTH CLOCKS ARE RUN. The suite steps frames itself, which is not how a loaded
// page runs on its own; a build that sounded from a timer of its own would sit
// quiet under a driven clock alone. So the game is also handed to the engine's own
// frame loop for a stretch of real time, and the bus is read after both.
//
// WHAT THIS DOES NOT DECIDE. That the build makes any sound at all once a key HAS
// been pressed, which is what the nine cue points above decide, and what a build
// silent for a different reason fails there rather than here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  ticksFor,
  type Harness,
} from "../harness";
import { watchSounds } from "./cues";

/**
 * Frames of the loaded game driven under the suite's clock.
 *
 * A whole second of the screen the game opens on, which is long enough for any
 * per-frame or timed sound a build might start to have started.
 */
const IDLE_FRAMES = ticksFor(1);

/**
 * Milliseconds the game is handed to the engine's OWN frame loop, in real time.
 *
 * Enough for that loop to run some two dozen frames of its own, so a build that
 * sounds from a timer it set rather than from a driven `advance` is read as well.
 */
const IDLE_MS = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays no cue before the player's first key press", async () => {
  // The loops the build starts from here on. Its PLAYS are already being recorded,
  // from before `initialize` ran.
  const started = watchSounds(h);
  // The game as the page left it: whatever screen the build opens on, with no key
  // ever delivered to it.
  const opened = h.snapshot();

  // A second of it under the suite's clock, then a stretch under the engine's own.
  await h.advance(IDLE_FRAMES);
  await h.runFor(IDLE_MS);

  const played = [...h.cues];
  const looped = started.filter((one) => one.how === "looped");
  captureStill(h, "loaded");

  assertLength(
    played,
    0,
    "cues the build played between the page loading and the first key — over " +
      `${String(IDLE_FRAMES)} driven frames and ${String(IDLE_MS)} ms of the ` +
      `engine's own loop on the ${opened.screen} screen, with no key ever ` +
      `pressed (specs/ui.md); it played ${played
        .map((one) => one.cue)
        .join(", ")}`,
  );
  assertEqual(
    looped.length,
    0,
    "cues the build set looping over that same idle, a loop being the bus's " +
      "other way of starting a sound (specs/ui.md); it looped " +
      looped.map((one) => one.cue).join(", "),
  );
});
