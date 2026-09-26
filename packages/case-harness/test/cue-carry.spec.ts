// A sound the build starts BETWEEN two driven frames still reaches the sinks.
//
// The driven loop reads the audio probe either side of every frame it runs, so a
// sound is stamped with the frame that produced it. A build that sounds from a
// DOM handler — the keydown that fires its pulse, the click that takes a menu —
// makes that sound while no frame is running, and a loop that read the probe
// afresh at the top of each drive would never see it: the count would move
// between two reads that nothing compares. So the first frame of a drive starts
// counting from where the last accounted read left off, and such a sound is
// credited to the first frame driven after it. What runs the build unaccounted —
// a skip, a stretch on the wall clock, the arming gesture — reads the probe past
// itself, so nothing that sounded inside it is handed to the next drive either.

import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, TICK_MS, watchCues, type Harness } from "./fixture";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("credits a sound made between two drives to the next driven frame", async () => {
  // Off live play, so the fixture's own every-fourth-tick cue stays out of it.
  await h.advance(2);
  const played = watchCues(h);

  // The fixture's `blip` is a surface call, so it sounds with no frame running —
  // exactly where a handler-time sound lands.
  await h.debug.blip();
  expect(played).toEqual([]);

  await h.advance(3);
  expect(played.map((cue) => cue.frame)).toEqual([3]);
  expect(played.map((cue) => cue.t)).toEqual([3 * TICK_MS]);
});

it("credits a sound the arming gesture is followed by to no frame", async () => {
  const played = watchCues(h);
  await h.debug.blip();
  // The gesture is delivered with no frame running and reads the probe past
  // itself: what sounded before it is not the next drive's.
  await h.armAudio();
  await h.advance(2);
  expect(played).toEqual([]);
});

it("credits a sound made before a skip to no frame", async () => {
  const played = watchCues(h);
  await h.debug.blip();
  // A skip runs frames nobody brackets, and says nothing about which of them
  // sounded — so it reads the probe past itself rather than leaving the sound
  // for the next driven frame.
  await h.skip(2);
  await h.advance(2);
  expect(played).toEqual([]);
});

it("credits a sound made between two batched sweeps to the next driven frame", async () => {
  await h.advance(1);
  const played = watchCues(h);
  await h.debug.blip();

  const swept = await h.sweep((snapshot) => snapshot.frames >= 3, null, {
    maxFrames: 5,
  });
  expect(swept.frames).toBe(2);
  expect(played.map((cue) => cue.frame)).toEqual([2]);
});
