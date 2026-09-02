// Wick — instrumentation/set-screen-title: `setScreen("title")` from `playing`
// enters `title` with `menuIndex` `0` and the idle run.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `title` row, "any | Discards the run exactly as `TITLE` on an end screen
// or `back` on `paused` does: the idle run"; and "Enters screen `name` ...
// with `menuIndex` `0`". The idle run is specs/state.md's, restated by
// `idleRun()`.
//
// WHY THE WORLD IS POSED AS IT IS. The run is given a clock and an enemy first,
// so "the idle run" after the call is a discard and not a run that was idle
// already.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  isolate,
  placeEnemy,
  poseScreen,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards the run and enters title", async () => {
  await isolate(h);
  await h.debug.setTick(100);
  await placeEnemy(h, "moth", 200, 0);

  const title = await poseScreen(h, "title");
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen after setScreen('title')");
  assertEqual(title.menuIndex, 0, "menuIndex on entering title");
  assertDeepEqual(documentedRun(title.run), idleRun(), "the run on title");
});
