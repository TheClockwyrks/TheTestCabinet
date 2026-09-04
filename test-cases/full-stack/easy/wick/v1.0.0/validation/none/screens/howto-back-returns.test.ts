// screens/howto-back-returns — `back` returns from the how-to screen to the
// title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`howto`"): "`back` returns to
// `title` with `menuIndex = 0`." specs/controls.md ("What each screen reads"),
// the `howto` row: "`back` returns to `title`; `mute`".
// specs/controls.md ("Actions and bindings"): "`back` | `Escape` | edge".
//
// WHY THE WORLD IS POSED AS IT IS. The how-to screen is entered through
// `setScreen("howto")`, which "Enters the how-to screen exactly as confirming
// `HOW TO PLAY` does", so the route touches no menu and a build with a broken
// title menu fails the title points rather than this one. The screen is read
// back before the press, and the press is a REAL `Escape` through Chromium's
// input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  pressBack,
  type Harness,
} from "../harness";
import { assertHighlight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads title with menuIndex 0 after Escape on howto", async () => {
  const howto = await poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the press is made on");

  const after = await pressBack(h);
  await captureStill(h, "back");

  assertHighlight(after, "title", 0, "after Escape on the how-to screen");
});
