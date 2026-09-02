// screens/almanac-no-music — no music loops on any frame of the almanac.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`, `chest`,
// or `paused` ... `title`, `howto`, and `almanac` carry no music."
// specs/ui.md ("`almanac`") says it from the screen's side as well: "The almanac
// holds the idle run, nothing advances while it is open, and no cue loops on
// it." "Exactly when" makes the almanac's silence a requirement rather than an
// absence, and "on every frame" is why this reads every frame of a stretch
// rather than one.
//
// WHY THE WORLD IS POSED AS IT IS. The build's audio is armed with a real
// browser gesture first, on a key bound to nothing, because a build is free to
// open its audio from a real DOM event. The almanac is then entered through
// `setScreen("almanac")`, which specs/instrumentation.md makes the same arrival
// as confirming `THE ALMANAC`, and two frames are run before the reading starts,
// since specs/instrumentation.md has "The two looping cues are reconciled from
// the state by the next frame". No key is pressed during the stretch, so the
// screen holds, which is read on every frame to confirm.
//
// WHY A RUN IS STARTED AFTERWARDS. A silence is only a reading if the build has
// something to be silent about: a build with no music at all would pass a bare
// silent stretch while failing every other music point, and the stretch would
// have decided nothing. So once the almanac has been read, `setScreen("playing")`
// begins a fresh run — specs/instrumentation.md: "Begins a fresh run exactly as
// `LIGHT THE LAMP` and `TRY AGAIN` do" — and the loop is waited for and asserted.
// That guard is a precondition rather than a second requirement: whether the loop
// starts with a run is `audio/music-starts-on-run`'s point.
//
// THE TOLERANCE. None: a loop is running on a frame or it is not.
// `ALMANAC_FRAMES` (`60`, one second) is a drive length that decides nothing
// beyond being long enough that a build whose bed opens late on the almanac is
// caught, and the wait for the guard's loop is a budget on the host's audio
// decode rather than a threshold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  isLooping,
  loopSourcesOf,
  poseScreen,
  type Harness,
} from "../harness";
import { openAlmanac } from "./almanac";

/** The cue the bed plays under. */
const MUSIC = "music";

/** One second of the almanac, read a frame at a time. */
const ALMANAC_FRAMES = TICK_HZ;

/** Frames run before the reading, for the loops to be reconciled from the state. */
const SETTLE_FRAMES = 2;

/** How long the guard waits for a loop a fresh run calls for: one second. */
const LOOP_WAIT_FRAMES = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("loops no music on any frame of the almanac", async () => {
  await h.armAudio();
  await openAlmanac(h);
  await h.step(SETTLE_FRAMES);

  const frames = await captureReplay(h, "silent", async () => {
    const read: Array<{ frame: number; screen: string; sources: number }> = [];
    for (let i = 0; i < ALMANAC_FRAMES; i += 1) {
      const snapshot = await h.step(1);
      read.push({
        frame: h.frame(),
        screen: snapshot.screen,
        sources: await loopSourcesOf(h, MUSIC),
      });
    }
    return read;
  });

  assertLength(frames, ALMANAC_FRAMES, "the frames of almanac read");
  for (const frame of frames) {
    assertEqual(
      frame.screen,
      "almanac",
      `the screen on frame ${frame.frame} of the almanac`,
    );
    assertEqual(
      frame.sources,
      0,
      `the music sources looping on frame ${frame.frame} of the almanac`,
    );
  }

  // The guard: this build has a music loop to be silent about.
  const started = await poseScreen(h, "playing");
  assertEqual(started.screen, "playing", "the screen the fresh run opened");
  let looping = await isLooping(h, MUSIC);
  for (let i = 0; i < LOOP_WAIT_FRAMES && !looping; i += 1) {
    await h.step(1);
    looping = await isLooping(h, MUSIC);
  }
  assertTrue(
    looping,
    "music looping once a run is under way, so the almanac's silence is a reading",
  );
});
