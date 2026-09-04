// audio/music-through-levelup — music is looping on every frame of an open
// level-up overlay.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused`. It starts on the frame a fresh run starts and keeps playing through
// the overlays and the pause". `levelup` is one of the four, so every frame the
// overlay is open is a frame the loop runs on — which is why this reads every
// frame of a stretch rather than one.
//
// WHY THE OVERLAY IS REACHED THE WAY IT IS. An isolated night: every driver
// switch off, nothing alive, nothing dropped, and no slot held, so nothing on any
// frame can end the run or move the screen off the overlay, and the pool is every
// candidate so the overlay has offers to show. One queued level-up and one tick
// open it, which is the route specs/progression.md states: "A `playing` tick that
// ends with `pendingLevelUps` above `0` runs to completion and then opens the
// overlay". No key is pressed while it is open, so nothing accepts an offer and
// the overlay stands for the whole stretch, which the screen is read on every
// frame to confirm. specs/ui.md holds the world still under it: on `levelup`
// "Nothing" advances.
//
// WHY THE LOOP IS ESTABLISHED FIRST. The stretch would pass vacuously on a build
// whose music never runs at all, so the loop is waited for on `playing` before
// the overlay opens, one frame per crossing, and asserted. The wait is a drive
// length rather than a threshold: a build loads and decodes its own produced
// `.wav` (specs/assets.md), and how long that takes is a fact about the host.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and OVERLAY
// _FRAMES (`60`, one second) is a drive length that decides nothing beyond being
// long enough that a build whose loop lapses under the overlay is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  openLevelUp,
  type Harness,
} from "../harness";
import { loopOverFrames, openNight, stepUntilLoop } from "./cues";

/** One second of the open overlay, read a frame at a time. */
const OVERLAY_FRAMES = TICK_HZ;

/** One level-up queued, enough to open one overlay. */
const QUEUED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("keeps music looping on every frame of an open level-up overlay", async () => {
  await openNight(h);
  const running = await stepUntilLoop(h, "music");
  assertEqual(running, true, "music looping on playing before the overlay");

  const under = await captureReplay(h, "levelup", async () => {
    const overlay = await openLevelUp(h, QUEUED);
    const frames = await loopOverFrames(h, "music", OVERLAY_FRAMES);
    return { overlay, frames };
  });

  assertEqual(
    under.overlay.screen,
    "levelup",
    "the screen the queued level-up opened",
  );
  assertLength(under.frames, OVERLAY_FRAMES, "the frames of overlay read");
  for (const frame of under.frames) {
    assertEqual(
      frame.screen,
      "levelup",
      `the screen on frame ${frame.frame} of the overlay`,
    );
    assertGreaterThanOrEqual(
      frame.sources,
      1,
      `the music sources looping on frame ${frame.frame} of the overlay`,
    );
  }
});
