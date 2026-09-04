// Wick — pointer/title-touch-confirms: a contact landing and lifting inside a
// title item's rectangle takes that item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, "The pointer
// and touch", rule 3: "a contact landing and lifting inside the rectangle of the
// item at `menuIndex` `i` selects that item and takes it exactly as `confirm` on
// it does." `specs/ui.md`, "`title`": "`HOW TO PLAY` | Sets `screen = howto` and
// `menuIndex = 0`", over `TITLE_ITEMS`, whose third item it is.
//
// WHY `HOW TO PLAY`. The item has to be one the contact moved the highlight
// onto, so the taking cannot be read as the title's opening selection being
// confirmed, and the screen it leads to starts no run, so what is read is the
// taking alone.
//
// THE DRIVE. `reset`, then a contact landing at the middle of the item's
// rectangle and lifting there, a frame each.
//
// THE TOLERANCE. None: a screen name and a menu index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  touchTapRect,
  type Harness,
} from "../harness";

/** The item the contact takes: `HOW TO PLAY`, the third of `TITLE_ITEMS`. */
const TAPPED = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("opens the how-to screen when a contact lands and lifts in its item", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the contact lands on");

  const rects = menuRects(h);
  assertLength(rects, TITLE_ITEMS.length, "the title menu's rectangles");

  const after = await touchTapRect(h, rects[TAPPED]);
  captureStill(h, "taken");

  assertEqual(after.screen, "howto", "the screen the contact took");
  assertEqual(after.menuIndex, 0, "menuIndex on arriving at the how-to screen");
});
