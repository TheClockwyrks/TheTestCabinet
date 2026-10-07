// audio/music-through-pause — music is looping on every frame of paused.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused`. It starts on the frame a fresh run starts and keeps playing through
// the overlays and the pause". `paused` is one of the four, so every frame the
// game is paused is a frame the loop runs on — which is why this reads every
// frame of a stretch rather than one. The pause is not an ending: specs/ui.md
// has `pause` return to `playing`, and only `back` on `paused` abandons the run,
// which is `audio/music-stops-on-abandon`'s point.
//
// WHY THE PAUSE IS REACHED THROUGH THE SURFACE. specs/instrumentation.md has
// the pose set `screen` and nothing else, with "the accumulator ...
// discard[ed], as every frame and pose that leaves `playing` does", so the
// world beneath is the one the run left. A key press would put the pause
// control's own correctness between this point and the loop it reads, and that
// control is `controls/`'s.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing can end the run
// before the pause. specs/ui.md holds the world still under it — on `paused`
// "Nothing" advances — and no key is pressed while it stands, so the screen holds
// for the whole stretch, which is read on every frame to confirm.
//
// WHY THE LOOP IS ESTABLISHED FIRST. The stretch would pass vacuously on a build
// whose music never runs at all, so the loop is waited for on `playing` before
// the pause, one frame per crossing, and asserted. The wait is a drive length
// rather than a threshold: a build loads and decodes its own produced `.wav`
// (specs/assets.md), and how long that takes is a fact about the host.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and
// PAUSE_FRAMES (`60`, one second) is a drive length that decides nothing beyond
// being long enough that a build whose loop lapses under the pause is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { loopOverFrames, openNight, stepUntilLoop } from "./cues";

/** One second of the pause, read a frame at a time. */
const PAUSE_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("keeps music looping on every frame of paused", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(running, true, "music looping on playing before the pause");

  const under = await captureReplay(h, "paused", async () => {
    const paused = await poseScreen(h, "paused");
    const frames = await loopOverFrames(h, "music", PAUSE_FRAMES);
    return { paused, frames };
  });

  assertEqual(under.paused.screen, "paused", "the screen the pause posed");
  assertLength(under.frames, PAUSE_FRAMES, "the frames of pause read");
  for (const frame of under.frames) {
    assertEqual(
      frame.screen,
      "paused",
      `the screen on frame ${frame.frame} of the pause`,
    );
    assertGreaterThanOrEqual(
      frame.sources,
      1,
      `the music sources looping on frame ${frame.frame} of the pause`,
    );
  }
});
