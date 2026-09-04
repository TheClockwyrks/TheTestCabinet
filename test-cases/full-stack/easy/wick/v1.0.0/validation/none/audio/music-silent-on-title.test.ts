// audio/music-silent-on-title — no music loops on any frame of the title after a
// fresh boot.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused`", and, plainly, "`title` and `howto` carry no music." "Exactly when"
// makes the title's silence a requirement rather than an absence, and "on every
// frame" is why this reads every frame of a stretch rather than one.
//
// WHY THE BOOT IS WHERE IT IS READ. The review item names the state: the title a
// fresh boot opens on, before any run has started. specs/ui.md ("`title`"): "The
// game opens here, and the debug surface's `reset` returns here", and
// specs/instrumentation.md has `reset` restore "the `title` screen with
// `menuIndex` `0`" and adds that "Any looping cue stops on the next frame", which
// the settling frames run. No key is pressed during the stretch, so the screen
// holds, which is read on every frame to confirm.
//
// WHY A RUN IS STARTED AFTERWARDS. A silence is only a reading if the build has
// something to be silent about: a build with no music at all would pass a bare
// silent stretch while failing every other music point, and the stretch would
// have decided nothing. So once the title has been read, `setScreen("playing")`
// stands the game on `playing`, which specs/ui.md is where `music` loops, and
// the loop is waited for and asserted.
// That guard is a precondition rather than a second requirement: whether the loop
// starts with a run is `audio/music-starts-on-run`'s point.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not, and
// TITLE_FRAMES (`60`, one second) is a drive length that decides nothing beyond
// being long enough that a build whose bed opens late on the title is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { loopOverFrames, SETTLE_FRAMES, stepUntilLoop } from "./cues";

/** One second of the title, read a frame at a time. */
const TITLE_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("loops no music on any frame of the title", async () => {
  await h.debug.reset();
  await h.step(SETTLE_FRAMES);
  const booted = await h.snapshot();
  assertEqual(booted.screen, "title", "the screen a fresh boot opens on");

  const frames = await captureReplay(h, "silent", () =>
    loopOverFrames(h, "music", TITLE_FRAMES),
  );

  assertLength(frames, TITLE_FRAMES, "the frames of title read");
  for (const frame of frames) {
    assertEqual(
      frame.screen,
      "title",
      `the screen on frame ${frame.frame} of the title`,
    );
    assertEqual(
      frame.sources,
      0,
      `the music sources looping on frame ${frame.frame} of the title`,
    );
  }

  // The guard: this build has a music loop to be silent about.
  const started = await poseScreen(h, "playing");
  assertEqual(started.screen, "playing", "the screen the fresh run opened");
  assertEqual(
    await stepUntilLoop(h, "music"),
    true,
    "music looping once a run is under way, so the title's silence is a reading",
  );
});
