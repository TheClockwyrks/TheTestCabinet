// audio/no-autoplay — nothing sounds between the page loading and the first key.
//
// `specs/ui.md`: "No sound is started between the page loading and the player's
// first key press: the game plays no cue before that first input."
//
// So the measurement is: build the game as a loaded page does, run it without ever
// delivering a key, and read the engine's cue bus. The bus announces a play
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
// AND THE FAR EDGE IS THE READ, NOT A STRETCH INSIDE IT. Both subscriptions are
// passive and stay live for the whole check: the bus announces a play
// synchronously, from inside the call the game makes, so a cue the build plays off
// a timer it set is recorded wherever in this check it fires, in real time,
// whether or not anything is stepping the game at that moment. Nothing here
// samples a window; the arrays below hold everything the bus announced between the
// build's first line and the read. What that window is, is the check's own
// duration — the harness, the art, and the frames it drives — rather than a span it
// sets aside. What it does not reach is a cue a build defers past the read, and no
// finite reading of a negative reaches that.
//
// SO NO STRETCH OF THE WALL CLOCK IS DRIVEN, and that is deliberate. Handing the
// game to the engine's own frame loop would reach no code these frames do not: the
// loop is a wall clock over the same tick `advance` runs, and a cue reaches the
// bus from the game's own call inside that tick. And what this point requires is
// silence before a key, not that the game advances on its own; the one point in
// this project whose requirement IS unstepped advance is
// `instrumentation/advances-in-real-time`, and even that one ends its wait on the
// build's own clock passing a floor rather than on a fixed span of the wall clock.
// A fixed span here would have decided nothing except how many frames of its own a
// busy host let the engine run — reach that rises and falls with the machine
// rather than with the build.
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
 * Two seconds of the screen the game opens on, which is long enough for any
 * per-frame or timed sound a build might start to have started, and more game
 * time than the engine's own loop covers over the same stretch of a busy host's
 * wall clock.
 */
const IDLE_FRAMES = ticksFor(2);

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

  // Two seconds of it, frame by frame, with no key ever delivered either.
  await h.advance(IDLE_FRAMES);

  const played = [...h.cues];
  const looped = started.filter((one) => one.how === "looped");
  captureStill(h, "loaded");

  assertLength(
    played,
    0,
    "cues the build played between the page loading and the first key — over " +
      `${String(IDLE_FRAMES)} driven frames on the ${opened.screen} screen, ` +
      `with no key ever pressed (specs/ui.md); it played ${played
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
