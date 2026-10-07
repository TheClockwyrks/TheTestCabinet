// Wick — pointer/almanac-entry-touch-highlights: a contact landing on an
// almanac entry row highlights that entry and takes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "the almanac's entry rows and its tab rectangles answer a
// contact exactly as they answer a press and a release", and rule 2 for an
// entry: "On `almanac` an entry carries no `confirm`, so a press on an entry
// only moves the highlight." The same file: on `almanac` "the rectangle at
// position `i` belongs to the entry at `menuIndex` `almanacScroll + i`".
//
// WHY THIS IS ITS OWN POINT. A finger never hovers, so the landing is the only
// way a contact reaches an entry: a build that moves its almanac highlight on a
// hover alone leaves a touch player reading the first entry and no other.
//
// WHAT IS READ. `menuIndex` and the screen after the whole gesture, over an
// unscrolled list, so the third reported row is the entry at `menuIndex` `2`.
//
// THE DRIVE. `reset`, `setScreen("almanac")`, and a contact landing at the
// middle of the third reported row and lifting there.
//
// THE TOLERANCE. None: a screen name and two indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  poseScreen,
  touchTapRect,
  type Harness,
} from "../harness";

/** The position of the third row of the visible window. */
const THIRD_ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the almanac highlight and takes nothing when a row is tapped", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the contact lands on");
  assertEqual(opened.menuIndex, 0, "the highlight before the contact");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const rects = menuRects(h);
  assertLength(rects, ALMANAC_ROWS, "the almanac's window of row rectangles");

  const after = await touchTapRect(h, rects[THIRD_ROW]);
  captureStill(h, "entry");

  assertEqual(after.menuIndex, THIRD_ROW, "the highlight the contact moved");
  assertEqual(
    after.screen,
    "almanac",
    "the screen the contact left, an entry carrying no confirm",
  );
});
