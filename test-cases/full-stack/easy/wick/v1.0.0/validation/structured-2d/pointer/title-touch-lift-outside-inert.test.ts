// Wick — pointer/title-touch-lift-outside-inert: a contact lifting outside the
// rectangle it landed in leaves that item selected and takes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "a contact lifting outside the rectangle it landed in
// leaves that item selected and takes nothing."
//
// WHY THIS IS ITS OWN POINT. It is the edge case the touch rule states in its
// own words, and the one a player relies on to change their mind: a finger that
// lands on the wrong entry and slides off must take nothing. A build that acts
// on the landing rather than on the lift passes every tap point and fails here,
// and so does one that takes whatever the lift fell on — both endpoints are
// items, so either mistake leaves the title.
//
// WHAT IS READ. The screen and the highlight after the lift.
//
// THE DRIVE. `reset`, a contact landing at the middle of the third item's
// rectangle, a move carrying the primary mask to the middle of the first, and a
// lift there, one partial frame each.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  centerOf,
  createHarness,
  menuRects,
  type Harness,
} from "../harness";
import {
  touchGlideToPartial,
  touchLandRectPartial,
  touchLiftAtPartial,
} from "./pointing";

/** Where the contact lands, and where it lifts: two different items. */
const LANDED = TITLE_ITEMS.indexOf("HOW TO PLAY");
const LIFTED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes nothing when the contact lifts outside the item it landed in", async () => {
  h.reset();
  const rects = menuRects(h);
  assertLength(rects, TITLE_ITEMS.length, "the title menu's rectangles");

  await touchLandRectPartial(h, rects[LANDED]);
  const away = centerOf(rects[LIFTED]);
  await touchGlideToPartial(h, away.x, away.y);
  const after = await touchLiftAtPartial(h, away.x, away.y);
  captureStill(h, "lifted");

  assertEqual(after.screen, "title", "the screen the contact left");
  assertEqual(
    after.menuIndex,
    LANDED,
    "the item the contact landed in, still selected",
  );
});
