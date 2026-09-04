// Wick — pointer/title-press-lift-outside-inert: a pointer dragged off the item
// it pressed before it lifts takes nothing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 2: "A primary press edge inside the rectangle of the item at
// `menuIndex` `i` sets `menuIndex` to `i` ... and arms that item. That press's
// release edge inside the same rectangle takes the armed item exactly as
// `confirm` on it does. A release edge anywhere else disarms it and takes
// nothing, so a pointer dragged off an item before it lifts takes nothing."
//
// WHY THIS IS ITS OWN POINT. It is the edge case rule 2 states in its own
// words, and the only one that separates a build taking an item on the PRESS
// from one taking it on the RELEASE: a click delivers both edges on one frame,
// so every other click point in this category passes either way.
//
// WHAT IS READ. The screen and the highlight after the lift. The press moves the
// highlight and nothing after it moves it back, so the pressed item is the one
// still selected.
//
// THE DRIVE. `reset`, the primary button pressed at the middle of the third
// item's rectangle, a move carrying the primary mask to the middle of the first,
// and the button lifted there, one partial frame each. Both endpoints are items,
// so a build that took whatever the lift fell on leaves the title too.
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
import { glideToPartial, liftAtPartial, pressRectPartial } from "./pointing";

/** Where the press lands, and where the pointer is dragged before it lifts. */
const PRESSED = TITLE_ITEMS.indexOf("HOW TO PLAY");
const LIFTED = TITLE_ITEMS.indexOf("LIGHT THE LAMP");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes nothing when the pointer lifts outside the item it pressed", async () => {
  h.reset();
  const rects = menuRects(h);
  assertLength(rects, TITLE_ITEMS.length, "the title menu's rectangles");

  const pressed = await pressRectPartial(h, rects[PRESSED]);
  assertEqual(pressed.menuIndex, PRESSED, "the highlight the press moved");
  assertEqual(pressed.screen, "title", "the screen the press alone left");

  const away = centerOf(rects[LIFTED]);
  await glideToPartial(h, away.x, away.y);
  const after = await liftAtPartial(h, away.x, away.y);
  captureStill(h, "lifted");

  assertEqual(after.screen, "title", "the screen the gesture left");
  assertEqual(
    after.menuIndex,
    PRESSED,
    "the item the press armed, still selected",
  );
});
