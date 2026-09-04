// Wick — screens/almanac-no-music: no music loops on the almanac.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, The loops: "`music`
// is looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused` ... `title`, `howto`, and `almanac` carry no music."
// The almanac's own section says the same: "no cue loops on it."
//
// WHAT IS READ. `world.audio.looping("music")`, "the bus's own answer", after
// each of sixty frames of the almanac — one second of frames at the `TICK_HZ`
// (`60`) `specs/overview.md` fixes. Every one of them owes `false`.
//
// THE DRIVE. A `playing` run posed through the debug surface and one frame,
// which is the frame the loops are "reconciled from the state on every frame",
// then `setScreen("almanac")`, which `specs/instrumentation.md` says enters the
// almanac by setting `screen` with the three menu indices at `0` and the run
// left as it stands. Arriving from `playing` is what makes the point a real
// one: a build that starts the bed and never stops it is caught here, where a
// build reaching the almanac from the title alone would never have started it.
// Whether the bed was up on `playing` at all belongs to the audio category, so
// it is recorded into the replay and decided nowhere here.
//
// THE TOLERANCE. None: a boolean on every frame, with no gap granted after
// the transition.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";

/** Frames of the almanac read: one second at TICK_HZ. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music not looping on any of sixty frames of the almanac", async () => {
  const trace = await captureReplay(h, "silent", async () => {
    h.reset();
    poseScreen(h, "playing");
    await h.advance(1);

    const entered = poseScreen(h, "almanac");
    assertEqual(entered.screen, "almanac", "the screen the frames are read on");

    const readings: boolean[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      await h.advance(1);
      readings.push(h.looping(CUES.music));
    }
    return readings;
  });

  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames of the almanac on which music was looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
