// audio/loop-single-source — a looping cue sounds through exactly one source
// across a stretch of frames.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "A looping cue
// sounds through a single source set to loop, from the frame that starts it until
// the frame that stops it, playing its file end to end with no gap; a cue is
// either looping or not, so starting one that is already looping changes
// nothing." So the count read on every frame is exactly one — not zero, which is
// a bed that lapsed, and not two, which is a second source layered over the
// first.
//
// WHERE THE SECOND START REQUEST COMES FROM. It is every frame of the stretch.
// specs/instrumentation.md: "Both loops are reconciled from the state on every
// frame, so a state the debug surface posed sounds, one frame later, exactly as
// the same state reached by play" — and specs/ui.md has `music` looping "on every
// frame exactly when `screen` is `playing`, `levelup`, `chest`, or `paused`". A
// run left standing on `playing` therefore asks, on each of the FRAMES (`120`)
// frames below, for `music` to be looping while it already is, and "starting one
// that is already looping changes nothing" is exactly the reading that the count
// never leaves one.
//
// WHY `music` IS THE CUE READ. It is the loop a night carries with nothing else
// posed, so the stretch needs no weapon, no enemy, and no overlay to keep it
// running; the same rule governs `hum`, whose own start and stop are the
// `audio/hum-*` points.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing over the two
// seconds can end the run, open an overlay, or start a second loop of its own,
// and the screen is read on every frame to confirm the run stayed on `playing`.
// The loop is waited for before the stretch begins, one frame per crossing,
// because a build loads and decodes its own produced `.wav` (specs/assets.md) and
// how long that takes is a fact about the host rather than about the build.
//
// THE TOLERANCE. None: a count of sources is a whole number, and the
// specification fixes it at one. FRAMES (`120`, two seconds) is the review item's
// own drive length and decides nothing beyond being long enough that a build
// which restarts its bed each frame, or lets it lapse, is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { loopOverFrames, openNight, stepUntilLoop } from "./cues";

/** The stretch the review item states: 120 frames, two seconds. */
const FRAMES = 2 * TICK_HZ;

/** The sources a looping cue sounds through: "a single source set to loop". */
const SOURCES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the music loop through exactly one source over 120 frames", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(running, true, "music looping on playing before the stretch");

  const frames = await captureReplay(h, "single", () =>
    loopOverFrames(h, "music", FRAMES),
  );

  assertLength(frames, FRAMES, "the frames of the stretch read");
  for (const frame of frames) {
    assertEqual(
      frame.screen,
      "playing",
      `the screen on frame ${frame.frame} of the stretch`,
    );
    assertEqual(
      frame.sources,
      SOURCES,
      `the music sources looping on frame ${frame.frame} of the stretch`,
    );
  }
});
