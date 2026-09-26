// Wick — instrumentation/set-screen-title: `setScreen("title")` from `playing`
// stands the game on `title` with `menuIndex` `0`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `setScreen(name)`):
// "Sets `screen` to `name`, one of the `Screen` values, with `menuIndex`,
// `almanacTab`, and `almanacScroll` all `0`", and "Applies on every screen".
// What the pose leaves standing beside the screen is
// `set-screen-leaves-the-run-standing`; what this decides is that the named
// screen is the one the game stands on afterwards.
//
// WHY THE WORLD IS POSED AS IT IS. The call is made from `playing`, a screen
// the game is not already on, so the `title` it reports is the call's. The
// night is isolated, so no tick runs between the pose and the reading and
// nothing else could have moved the screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

it("stands the game on title", async () => {
  const playing = await isolate(h);
  assertEqual(playing.screen, "playing", "the screen the call is made from");

  const title = await poseScreen(h, "title");
  await captureStill(h, "title");

  assertEqual(title.screen, "title", "the screen after setScreen('title')");
  assertEqual(title.menuIndex, 0, "menuIndex on entering title");
});
