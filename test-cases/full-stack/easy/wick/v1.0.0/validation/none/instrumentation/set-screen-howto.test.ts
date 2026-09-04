// Wick — instrumentation/set-screen-howto: `setScreen("howto")` from `title`
// enters `howto` with `menuIndex` `0` and the idle run.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// the `howto` row, "any | Enters the how-to screen exactly as confirming
// `HOW TO PLAY` does: the idle run"; "with `menuIndex` `0`". specs/ui.md: the
// title's `HOW TO PLAY` "Sets `screen = howto` and `menuIndex = 0`".
//
// WHY THE WORLD IS POSED AS IT IS. The title is where the harness's reset
// leaves the game; `menuIndex` is moved off `0` first so the `0` after the call
// is the call's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  documentedRun,
  idleRun,
  poseScreen,
  pressDown,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters the how-to screen with the idle run", async () => {
  const moved = await pressDown(h);
  assertEqual(moved.screen, "title", "the screen the call is made from");
  assertEqual(moved.menuIndex, 1, "menuIndex moved off 0 before the call");

  const howto = await poseScreen(h, "howto");
  await captureStill(h, "howto");

  assertEqual(howto.screen, "howto", "the screen after setScreen('howto')");
  assertEqual(howto.menuIndex, 0, "menuIndex on entering howto");
  assertDeepEqual(documentedRun(howto.run), idleRun(), "the run on howto");
});
