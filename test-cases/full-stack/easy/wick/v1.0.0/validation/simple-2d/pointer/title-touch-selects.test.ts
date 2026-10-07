// pointer/title-touch-selects — a contact landing on a title item selects it.
//
// WHAT THIS DECIDES. One thing: the landing alone moves `menuIndex` onto the
// item the contact fell in. What the LIFT does is
// `pointer/title-touch-confirms`'.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer and touch), rule 3: "A touch contact landing
//   inside a rectangle is that rectangle's press edge and lifting is its release
//   edge."
//   The same file, rule 2, is what that press edge does: "A primary press edge
//   inside the rectangle of the item at `menuIndex` `i` sets `menuIndex` to
//   `i`."
//
// WHY IT IS A POINT OF ITS OWN. A finger never hovers, so nothing moves the
// highlight before the contact lands: a build that moves its highlight on a
// hover alone leaves a touch player unable to select anything, and passes every
// hover point in this category while failing here.
//
// THE DRIVE. The title through `setScreen`, which leaves `menuIndex` `0`, then
// a contact landing at the middle of the SECOND item's rectangle and LEFT
// DOWN, so the reading is of the landing alone.
//
// THE TOLERANCE. None: a menu index and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScene,
  touchLandRect,
  type Harness,
} from "../harness";
import { menuRectAt } from "./pointing";

/** The item the contact lands on: not the one the title opens highlighted on. */
const LANDED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("selects the title item a contact lands on", async () => {
  const before = poseScene(h, "title");
  assertEqual(before.screen, "title", "the screen the contact lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the contact");

  const rect = menuRectAt(h, LANDED, "the second title item");
  const after = await touchLandRect(h, rect);
  captureStill(h, "landed");

  assertEqual(after.menuIndex, LANDED, "the highlight the landing moved");
  assertEqual(after.screen, "title", "the screen a contact still down left");
});
