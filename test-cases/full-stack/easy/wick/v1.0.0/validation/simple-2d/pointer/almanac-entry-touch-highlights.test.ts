// pointer/almanac-entry-touch-highlights — a contact landing on an almanac
// entry row highlights that entry and takes nothing.
//
// WHAT THIS DECIDES. One thing: a contact on a visible row moves `menuIndex`
// onto the entry that row belongs to, with the screen unchanged.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "the almanac's entry rows
//   and its tab rectangles answer a contact exactly as they answer a press and a
//   release", and rule 2 for an entry: "On `almanac` an entry carries no
//   `confirm`, so a press on an entry only moves the highlight."
//   The same file: on `almanac` "the rectangle at position `i` belongs to the
//   entry at `menuIndex` `almanacScroll + i`".
//
// WHY IT IS A POINT OF ITS OWN. A finger never hovers, so the landing is the
// only way a contact reaches an entry: a build that moves its almanac highlight
// on a hover alone leaves a touch player reading the first entry and no other.
//
// THE DRIVE. The almanac through `setScreen`, which leaves `menuIndex` and
// `almanacScroll` both `0`, then a contact landing at the middle of the THIRD
// reported row and lifting there. The list is unscrolled, so that row is the
// entry at `menuIndex` `2`.
//
// THE TOLERANCE. None: a screen name and two indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  touchTapRect,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

/** The visible row the contact lands on: the third, at an unscrolled list. */
const ROW = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the almanac highlight and takes nothing when a row is tapped", async () => {
  const before = poseScene(h, "almanac");
  assertEqual(before.screen, "almanac", "the screen the contact lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the contact");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");

  const rect = menuRectAt(h, ROW, "the third visible entry row");
  const after = await touchTapRect(h, rect);
  captureStill(h, "entry");

  assertEqual(after.menuIndex, ROW, "the highlight the contact moved");
  assertEqual(
    after.screen,
    "almanac",
    "the screen the contact left, an entry carrying no confirm",
  );
});
