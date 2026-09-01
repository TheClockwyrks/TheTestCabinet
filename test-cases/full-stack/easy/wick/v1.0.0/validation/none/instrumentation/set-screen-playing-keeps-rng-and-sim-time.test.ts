// Wick — instrumentation/set-screen-playing-keeps-rng-and-sim-time: `rngState`
// and `simTime` hold the same values after `setScreen("playing")` as before it.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `playing | any other` row: "`rngState` and `simTime` stay as they are, so
// a run from a known seed is `reset` followed by this."
//
// WHY THE WORLD IS POSED AS IT IS. The generator is seeded with a seed of this
// check's own and a few title frames are run so `simTime` is not `0`; then the
// fresh run is begun from the title, and again from an end screen, and both
// figures are read exactly across each call. A build that reseeded or restarted
// its clock on a fresh run changes at least one. Each call is bracketed inside
// the page, because the same document leaves the build's own loop running in
// real time while the clock is held and has `simTime` rise by the delta of
// every frame it runs, so a reading taken across two crossings would count
// those frames too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import {
  bracket,
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";

const SEED = 5150;
const TITLE_FRAMES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves rngState and simTime as they are across a fresh run", async () => {
  await h.debug.reset({ seed: SEED });
  const before = await h.step(TITLE_FRAMES);
  assertNotEqual(before.simTime, 0, "simTime before the fresh run");

  const first = await bracket(h, "setScreen", ["playing"]);
  assertEqual(first.before.screen, "title", "the screen the first call is made on");
  assertEqual(first.after.screen, "playing", "the screen after setScreen('playing')");
  assertEqual(first.after.rngState, first.before.rngState, "rngState across the fresh run from title");
  assertEqual(first.after.simTime, first.before.simTime, "simTime across the fresh run from title");

  // And from an end screen, after the run has drawn from the generator.
  await h.step(TITLE_FRAMES);
  await poseScreen(h, "fallen");
  const second = await bracket(h, "setScreen", ["playing"]);
  await captureStill(h, "kept");
  assertEqual(second.before.screen, "fallen", "the screen the second call is made on");
  assertEqual(second.after.screen, "playing", "the screen after the second setScreen('playing')");
  assertEqual(second.after.rngState, second.before.rngState, "rngState across the fresh run from fallen");
  assertEqual(second.after.simTime, second.before.simTime, "simTime across the fresh run from fallen");
});
