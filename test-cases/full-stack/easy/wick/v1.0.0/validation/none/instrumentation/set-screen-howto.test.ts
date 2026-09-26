// Wick — instrumentation/set-screen-howto: `setScreen("howto")` from `title`
// stands the game on `howto` with `menuIndex` `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
//
// WHY THE WORLD IS POSED AS IT IS. The title is where the harness's reset
// leaves the game; `menuIndex` is moved off `0` first, so the `0` after the
// call is the call's rather than a figure that was already `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
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

it("stands the game on the how-to screen", async () => {
  const moved = await pressDown(h);
  assertEqual(moved.screen, "title", "the screen the call is made from");
  assertEqual(moved.menuIndex, 1, "menuIndex moved off 0 before the call");

  const howto = await poseScreen(h, "howto");
  await captureStill(h, "howto");

  assertEqual(howto.screen, "howto", "the screen after setScreen('howto')");
  assertEqual(howto.menuIndex, 0, "menuIndex on entering howto");
});
