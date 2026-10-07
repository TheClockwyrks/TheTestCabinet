// Wick — instrumentation/reset-stops-loops: with `music` and `hum` both
// looping, `reset()` followed by one frame leaves neither cue looping.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `reset()`):
// "Any looping cue stops on the next frame, which `step(1)` runs one of."
// specs/ui.md — "The loops": "`music` is looping on every frame exactly when
// `screen` is `playing`, `levelup`, `chest`, or `paused`" and "`hum` is looping
// on every frame exactly when `screen` is `playing` and a held weapon is `halo`
// or `corona`"; "`title` and `howto` carry no music". So both loops run on a
// run holding Halo, and after a reset to `title` neither may.
//
// WHY THE WORLD IS POSED AS IT IS. A fresh run with Halo held and one frame run
// is the least state on which both loops sound; the probe names each loop by
// the produced file it plays, and the precondition that both are heard is read
// before the reset so the silence after it is the reset's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isLooping,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("stops music and hum on the frame after a reset", async () => {
  await startRun(h);
  await holdWeapon(h, "halo", 1);
  await h.step(1);
  assertEqual(await isLooping(h, "music"), true, "music looping on the run");
  assertEqual(await isLooping(h, "hum"), true, "hum looping with Halo held");

  await h.debug.reset();
  await h.step(1);
  await captureStill(h, "silenced");
  assertEqual(await isLooping(h, "music"), false, "music looping after reset");
  assertEqual(await isLooping(h, "hum"), false, "hum looping after reset");
});
