// screens/almanac-back-returns — `back` returns from the almanac to the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`back` returns to
// `title` with `menuIndex`, `almanacTab`, and `almanacScroll` all `0`."
// specs/controls.md ("What each screen reads"), the `almanac` row: "`back`
// returns to `title`; `mute`". specs/controls.md ("Actions and bindings"):
// "`back` | `Escape` | edge".
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md makes the same arrival
// as confirming `THE ALMANAC`, so the route touches no menu and a build with a
// broken title menu fails the title points rather than this one. The screen is
// read back before the press, and the press is a REAL `Escape` through
// Chromium's input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressBack,
  type Harness,
} from "../harness";
import { openAlmanac } from "./almanac";
import { assertHighlight } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads title with menuIndex 0 after Escape on the almanac", async () => {
  const almanac = await openAlmanac(h);
  assertEqual(almanac.screen, "almanac", "the screen the press is made on");

  const after = await pressBack(h);
  await captureStill(h, "back");

  assertHighlight(after, "title", 0, "after Escape on the almanac");
});
