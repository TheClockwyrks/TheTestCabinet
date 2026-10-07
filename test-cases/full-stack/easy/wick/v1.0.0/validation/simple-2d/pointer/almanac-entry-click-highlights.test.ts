// pointer/almanac-entry-click-highlights — clicking an almanac entry only moves
// the highlight.
//
// WHAT THIS DECIDES. One thing: on `almanac` with `almanacScroll` `0` and
// `menuIndex` `0`, a primary press inside the rectangle of the row at position
// `2` leaves `menuIndex` at `2` with the screen still `almanac`. An entry
// carries no confirmation, so the click that takes an item everywhere else
// takes nothing here.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 2: "A primary press edge inside the
//   rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i` ... On
//   `almanac` an entry carries no `confirm`, so a click on an entry only moves
//   the highlight."
//   specs/controls.md (The pointer): "the rectangle at position `i` belongs to
//   the entry at `menuIndex` `almanacScroll + i`."
//   specs/ui.md (`almanac`): "`menuIndex`, `almanacTab`, and `almanacScroll`
//   are `0` on arriving", and "`confirm` and `pause` do nothing here".
//   specs/instrumentation.md (Menus): "`almanac` reports one rectangle per
//   visible entry row, in list order from `almanacScroll`".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The highlight and the screen
// after the click. The highlight says the press was answered; the screen says
// nothing was taken, which is the half of the rule an entry is exempt from.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does" (specs/instrumentation.md);
// then a primary press at the middle of the rectangle the build reported for
// position `2`, and the one frame that reads it. Nothing advances on `almanac`
// (specs/ui.md), so the frame is a whole one.
//
// THE TOLERANCE. None: a menu index and a screen name are discrete figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  clickRect,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

let h: Harness;

/** The row clicked: position 2 of the visible window. */
const CLICKED = 2;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the almanac highlight and takes nothing when an entry row is clicked", async () => {
  const before = poseScene(h, "almanac");
  assertEqual(before.screen, "almanac", "the screen the click lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the click");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");

  const rect = menuRectAt(h, CLICKED, "the third visible entry row");
  const after = await clickRect(h, rect);
  captureStill(h, "clicked");

  assertEqual(
    after.menuIndex,
    CLICKED,
    "the highlight after the click landed in position 2's rectangle, which specs/controls.md gives to the entry at almanacScroll + 2",
  );
  assertEqual(
    after.screen,
    "almanac",
    "the screen the click left the game on, an entry carrying no confirm",
  );
});
