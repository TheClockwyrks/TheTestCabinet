// Wick — instrumentation/set-screen-title: `setScreen('title')` shows the title
// screen with `menuIndex` `0`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setScreen`: "Sets `screen` to `name`, one of the `Screen` values, with
// `menuIndex`, `almanacTab`, and `almanacScroll` all `0`", and "Applies on
// every screen".
//
// WHAT IS READ, AND WHY. The screen and the highlight. The highlight is the
// half a build can get wrong while still switching screens, so it is carried
// OFF `0` before the call by a real `down` press on the almanac the pose
// reached — the only way an index the pose is supposed to zero can be non-zero
// beforehand. What the pose does to the RUN is
// `instrumentation/set-screen-playing`'s point, and what a real `back`
// press on `howto` or `almanac` selects is `screens/`'s.
//
// THE DRIVE. `reset` to the title, a pose to `almanac`, one `down` press to
// carry `menuIndex` off `0`, then the pose to `title`, read at the call.
//
// THE TOLERANCE. None: a screen name and a whole index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("shows the title with the highlight back at 0", async () => {
  h.reset();
  poseScreen(h, "almanac");
  const moved = await tap(h, "ArrowDown");
  assertEqual(moved.menuIndex, 1, "menuIndex moved off 0 before the pose");

  h.debug.setScreen("title");
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "title");

  assertEqual(after.screen, "title", "screen after setScreen('title')");
  assertEqual(after.menuIndex, 0, "menuIndex after setScreen('title')");
});
