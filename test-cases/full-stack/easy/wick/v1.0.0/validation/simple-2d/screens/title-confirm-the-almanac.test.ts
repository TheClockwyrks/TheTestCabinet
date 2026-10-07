// screens/title-confirm-the-almanac — THE ALMANAC opens the almanac.
//
// WHAT THIS DECIDES. One thing: `confirm` on the title's second item leaves the
// game on `almanac` with `menuIndex`, `almanacTab`, and `almanacScroll` all
// `0`. What the almanac then shows, and how it is left, are their own points.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`title`): "`THE ALMANAC` | Sets `screen = almanac`, with
//   `menuIndex`, `almanacTab`, and `almanacScroll` all `0`", with `TITLE_ITEMS`
//   "`LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`, in that order".
//   specs/controls.md ("Actions and bindings"): `confirm` is `Enter`, `Space`.
//
// THE DRIVE. A reset to the title, then `ArrowDown` to bring the highlight onto
// `THE ALMANAC` and the precondition asserted, then the `Enter` this point is
// about. The surface poses no `menuIndex`, so the menu's own key is the only
// way to the second item, and the item is found by its place in `TITLE_ITEMS`
// rather than by a written-in index.
//
// THE TOLERANCE. None: a screen name and three indices are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, tap, type Harness } from "../harness";
import { DOWN_KEY, tapTimes } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters the almanac when THE ALMANAC is confirmed", async () => {
  h.reset();
  const wanted = TITLE_ITEMS.indexOf("THE ALMANAC");
  const staged = await tapTimes(h, DOWN_KEY, wanted);
  assertEqual(staged.screen, "title", "the screen Enter is pressed on");
  assertEqual(staged.menuIndex, wanted, "the highlight resting on THE ALMANAC");

  const after = await tap(h, "Enter");
  captureStill(h, "almanac");

  assertEqual(after.screen, "almanac", "the screen Enter left the game on");
  assertEqual(after.menuIndex, 0, "the entry highlighted on arriving");
  assertEqual(after.almanacTab, 0, "the tab shown on arriving");
  assertEqual(after.almanacScroll, 0, "the list's first row on arriving");
});
