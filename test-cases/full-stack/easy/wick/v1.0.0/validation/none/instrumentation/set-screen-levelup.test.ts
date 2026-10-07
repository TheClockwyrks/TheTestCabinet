// Wick — instrumentation/set-screen-levelup: `setScreen("levelup")` from
// `playing` stands the game on `levelup` with `menuIndex` `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// The pose opens no overlay: "a run is never begun, discarded, ended, or grown
// by it", and "the level-up overlay is `setPendingLevelUps` and one `playing`
// tick", which `progression/overlay-opens-same-tick` decides.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with nothing queued, so
// the `levelup` the reading finds is the pose's rather than an overlay the
// game opened for itself, and the empty `offers` afterwards is the pose
// declining to draw. No tick is run, so nothing else could have moved the
// screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
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

it("stands the game on the level-up screen", async () => {
  const posed = await isolate(h);
  assertEqual(posed.screen, "playing", "the screen the call is made from");
  assertEqual(posed.run.pendingLevelUps, 0, "pendingLevelUps before the call");

  const overlay = await poseScreen(h, "levelup");
  await captureStill(h, "levelup");

  assertEqual(
    overlay.screen,
    "levelup",
    "the screen after setScreen('levelup')",
  );
  assertEqual(overlay.menuIndex, 0, "menuIndex on entering levelup");
  assertLength(overlay.run.offers, 0, "the offers the pose drew");
});
