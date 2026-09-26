// screens/almanac-back-returns — `back` returns from the almanac to the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`back` returns to
// `title` with `THE ALMANAC` selected and `almanacTab` and `almanacScroll` both
// `0`", which "Menu navigation" states as the rule for `title`: it "selects the
// entry that led away from it". `THE ALMANAC` is `TITLE_ITEMS[1]`.
// specs/controls.md ("What each screen reads"), the `almanac` row: "`back`
// returns to `title`; `mute`". specs/controls.md ("Actions and bindings"):
// "`back` | `Escape` | edge".
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which stands the game on it without touching a menu,
// so a build with a broken title menu fails the title points rather than this
// one. The screen is
// read back before the press, and the press is a REAL `Escape` through
// Chromium's input pipeline held across exactly one frame.
//
// THE TOLERANCE. None: a screen name and an index are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pressBack,
  type Harness,
} from "../harness";
import { openAlmanac } from "./almanac";
import { assertHighlight } from "./stage";

/** Where `THE ALMANAC`, the entry that led away from the title, sits. */
const ALMANAC_ITEM = TITLE_ITEMS.indexOf("THE ALMANAC");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads title with THE ALMANAC selected after Escape on the almanac", async () => {
  const almanac = await openAlmanac(h);
  assertEqual(almanac.screen, "almanac", "the screen the press is made on");

  const after = await pressBack(h);
  await captureStill(h, "back");

  assertHighlight(after, "title", ALMANAC_ITEM, "after Escape on the almanac");
});
