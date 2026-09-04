// Wick — pointer/title-touch-selects: a contact landing on a title item selects
// it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "A touch contact landing inside a rectangle is that
// rectangle's press edge and lifting is its release edge", and rule 2, which is
// what that press edge does: "A primary press edge inside the rectangle of the
// item at `menuIndex` `i` sets `menuIndex` to `i`."
//
// WHY THIS IS ITS OWN POINT. A finger never hovers, so nothing moves the
// highlight before the contact lands: a build that moves its highlight on a
// hover alone leaves a touch player unable to select anything, and passes every
// hover point in this category while failing here. What the LIFT does is
// `pointer/title-touch-confirms`'.
//
// WHAT IS READ. `menuIndex` and the screen after the landing, with the contact
// still down, so the reading is of the landing alone.
//
// THE DRIVE. `reset` opens the title with `menuIndex` `0`, then a contact lands
// at the middle of the SECOND item's rectangle.
//
// THE TOLERANCE. None: a menu index and a screen name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  touchLandRect,
  type Harness,
} from "../harness";

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
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the contact lands on");
  assertEqual(before.menuIndex, 0, "the highlight before the contact");

  const rects = menuRects(h);
  assertLength(rects, TITLE_ITEMS.length, "the title menu's rectangles");

  const after = await touchLandRect(h, rects[LANDED]);
  captureStill(h, "landed");

  assertEqual(after.menuIndex, LANDED, "the highlight the landing moved");
  assertEqual(after.screen, "title", "the screen a contact still down left");
});
