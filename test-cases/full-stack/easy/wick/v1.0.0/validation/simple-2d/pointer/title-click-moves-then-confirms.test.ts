// pointer/title-click-moves-then-confirms — a click takes the item it lands in,
// not the item the highlight was on.
//
// WHAT THIS DECIDES. One thing: on `title` with `menuIndex` `0`, a primary
// press inside `HOW TO PLAY`'s rectangle leaves the game on `howto`. The click
// rule moves the highlight to the rectangle it landed in FIRST and takes that
// item, so a build that confirmed whatever the highlight already held would
// start a run here instead.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i`, playing
//   `menu-move` if that changed it, and then takes that item exactly as
//   `confirm` on it does."
//   specs/ui.md (`title`): "`HOW TO PLAY` | Sets `screen = howto` and
//   `menuIndex = 0`", the menu `TITLE_ITEMS` being "`LIGHT THE LAMP`,
//   `THE ALMANAC`, `HOW TO PLAY`, in that order", and "`menuIndex` is `0` on
//   arriving".
//   specs/instrumentation.md (Menus): `menuRects` reports one rectangle per
//   item "in menu order", so the last position is `HOW TO PLAY`'s.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The screen after the click, and
// the highlight the arrival left. `howto` is reachable from the title by no
// other item, so the screen alone names which item the click took; the
// `menuIndex` of `0` is the arrival rule the item itself carries.
//
// THE DRIVE. The title through `setScreen`, "exactly as the real transition
// into it enters it" (specs/instrumentation.md), with the highlight asserted at
// `0` so the item clicked is provably not the item highlighted; then a primary
// press at the middle of the rectangle the build reported for the last
// position, and the one frame that reads it. Nothing advances on `howto`
// (specs/ui.md, What advances on each screen), so the frame is a whole one.
//
// THE TOLERANCE. None: a screen name and a menu index are discrete figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickRect,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The item clicked: `HOW TO PLAY`, position 2 of `TITLE_ITEMS`. */
const CLICKED = TITLE_ITEMS.indexOf("HOW TO PLAY");

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("enters howto when the third title item is clicked from a highlight on the first", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the click lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the click");
  assertNotEqual(
    before.menuIndex,
    CLICKED,
    "the highlight, which the clicked item is deliberately not on",
  );

  const rect = menuRectAt(h, CLICKED, "the third title item");
  const after = await clickRect(h, rect);
  captureStill(h, "clicked");

  assertEqual(
    after.screen,
    "howto",
    "the screen the click left the game on, which only HOW TO PLAY leads to",
  );
  assertEqual(
    after.menuIndex,
    0,
    "the highlight on arriving at howto, which specs/ui.md sets to 0",
  );
});
