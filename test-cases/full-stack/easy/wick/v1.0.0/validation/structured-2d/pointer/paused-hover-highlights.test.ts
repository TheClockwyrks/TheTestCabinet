// Wick — pointer/paused-hover-highlights: the pointer resting on MAIN MENU
// highlights it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer:
// `paused` is one of the screens that "answers the pointer", and "On `title`,
// `levelup`, `paused`, `fallen`, and `dawn` that is every item of the menu, and
// the rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule
// 1, Hover: "The pointer inside the rectangle of the item at `menuIndex` `i`,
// with `menuIndex` not `i`, sets `menuIndex` to `i`." `specs/ui.md`,
// "`paused`", gives the menu `PAUSE_ITEMS`, "`RESUME`, `MAIN MENU`, in that
// order", with `menuIndex` `0` on arriving, so `MAIN MENU` is `menuIndex` `1`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot,
// which is the item `confirm` would take. Nothing is taken here: a hover moves
// a highlight and no more, so `screen` stays `paused`.
//
// THE DRIVE. An isolated `playing` world holding nothing with every driver
// switch off, paused through `setScreen("paused")` — which
// `specs/instrumentation.md` says enters it by setting `screen` alone, with the
// run left as it stands — then `MAIN MENU`'s rectangle read off `menuRects` and
// the pointer moved to its middle for one frame. The point is the build's own:
// the specification fixes no layout for the pause menu.
//
// THE TOLERANCE. None on the index. The point is the rectangle's centre, the
// one point inside it that no padding, border, or rounding can put outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  isolate,
  menuRects,
  poseScreen,
  type Harness,
} from "../harness";

/** The index of MAIN MENU, the second item of PAUSE_ITEMS (specs/ui.md). */
const MAIN_MENU = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 1 with the pointer inside MAIN MENU", async () => {
  isolate(h);
  const paused = poseScreen(h, "paused");
  assertEqual(paused.screen, "paused", "the screen the pointer rests on");
  assertEqual(paused.menuIndex, 0, "menuIndex on arriving at the pause menu");

  const rects = menuRects(h);
  assertLength(
    rects,
    PAUSE_ITEMS.length,
    "the pause menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await hoverRect(h, rects[MAIN_MENU]);
  captureStill(h, "hover");

  assertEqual(after.screen, "paused", "the screen the hover left");
  assertEqual(
    after.menuIndex,
    MAIN_MENU,
    "menuIndex with the pointer inside MAIN MENU's rectangle (specs/controls.md, Hover)",
  );
});
