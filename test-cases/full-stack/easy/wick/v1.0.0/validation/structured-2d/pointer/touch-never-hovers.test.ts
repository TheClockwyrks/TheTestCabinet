// Wick — pointer/touch-never-hovers: a contact travelling across another item's
// rectangle does not move the highlight onto it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 1: "A touch contact never hovers: only a device reporting a
// position while out of contact moves the highlight this way." A finger reports
// a position only while it is down, so the rule says a position reported IN
// contact never hovers.
//
// WHY THIS IS ITS OWN POINT. A build that feeds a contact's position into the
// hover rule looks right for a tap, because a landing selects what it lands in
// anyway, and is wrong the moment the finger travels: the highlight follows it
// and the lift then takes an item the player never chose. That the LIFT outside
// the landing's rectangle takes nothing is
// `pointer/title-touch-lift-outside-inert`'s.
//
// WHAT IS READ. `menuIndex` after the travel, with no lift, so the reading is of
// the travel and of nothing else.
//
// THE DRIVE. `reset`, a contact landing at the middle of the second item's
// rectangle, and a move carrying the primary mask to the middle of the first.
//
// THE TOLERANCE. None: a menu index.

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
import { touchGlideToPartial, touchLandRectPartial } from "./pointing";

/** Where the contact lands, and the item it travels over afterwards. */
const LANDED = 1;
const CROSSED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the highlight where the contact landed while it travels", async () => {
  h.reset();
  const rects = menuRects(h);
  assertLength(rects, TITLE_ITEMS.length, "the title menu's rectangles");

  const landed = await touchLandRectPartial(h, rects[LANDED]);
  assertEqual(landed.menuIndex, LANDED, "the highlight the landing moved");

  const crossed = centerOf(rects[CROSSED]);
  const after = await touchGlideToPartial(h, crossed.x, crossed.y);
  captureStill(h, "held");

  assertEqual(
    after.menuIndex,
    LANDED,
    "the highlight after the contact travelled over another item",
  );
  assertEqual(after.screen, "title", "the screen the travel left");
});
