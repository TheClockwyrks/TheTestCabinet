// screens/almanac-back-returns — back returns from the almanac.
//
// WHAT THIS DECIDES. One thing: a `back` press on `almanac` leaves the game on
// `title` with `menuIndex` 0.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`back` returns to `title` with `menuIndex`,
//   `almanacTab`, and `almanacScroll` all `0`."
//   specs/controls.md ("What each screen reads"): on `almanac`, "`back` returns
//   to `title`".
//   specs/controls.md ("Actions and bindings"): `back` is `Escape`.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which enters it
// "exactly as confirming `THE ALMANAC` does" (specs/instrumentation.md), so the
// title's menu is not walked to get there, then one real `Escape` press over
// one frame.
//
// THE TOLERANCE. None: a screen name and a menu index are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
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

it("returns to the title from the almanac", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen Escape is pressed on");

  const after = await tap(h, "Escape");
  captureStill(h, "back");

  assertEqual(after.screen, "title", "the screen Escape left the game on");
  assertEqual(after.menuIndex, 0, "the highlight on arriving at the title");
});
