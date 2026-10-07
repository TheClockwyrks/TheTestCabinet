// Wick — pointer/end-hover-highlights: on the fallen screen the pointer
// resting on TITLE highlights it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer:
// `fallen` is one of the screens that "answers the pointer", and "On `title`,
// `levelup`, `paused`, `fallen`, and `dawn` that is every item of the menu, and
// the rectangle at position `i` belongs to the item at `menuIndex` `i`." Rule
// 1, Hover: "The pointer inside the rectangle of the item at `menuIndex` `i`,
// with `menuIndex` not `i`, sets `menuIndex` to `i`." `specs/ui.md`,
// "`fallen` and `dawn`", gives the menu `END_ITEMS`, "`TRY AGAIN`, `TITLE`, in
// that order", with `menuIndex` `0` on arriving, so `TITLE` is `menuIndex` `1`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot,
// which is the item `confirm` would take. Nothing is taken here: a hover moves
// a highlight and no more, so `screen` stays `fallen` and the ended run is
// still the one the end screen reports.
//
// THE DRIVE. An isolated `playing` run with every driver switch off, ended
// fallen by posing `hp` to `0` and running the one tick `specs/world.md` ends
// the run on; then `TITLE`'s rectangle read off `menuRects` and the pointer
// moved to its middle for one frame. The point is the build's own: the
// specification fixes no layout for the end menu.
//
// THE TOLERANCE. None on the index. The point is the rectangle's centre, the
// one point inside it that no padding, border, or rounding can put outside.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { END_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  endFallen,
  hoverRect,
  isolate,
  menuRects,
  type Harness,
} from "../harness";

/** The index of TITLE, the second item of END_ITEMS (specs/ui.md). */
const TITLE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 1 with the pointer inside TITLE on the fallen screen", async () => {
  isolate(h);
  const ended = await endFallen(h);
  assertEqual(ended.screen, "fallen", "the screen the pointer rests on");
  assertEqual(ended.menuIndex, 0, "menuIndex on arriving at the end screen");

  const rects = menuRects(h);
  assertLength(
    rects,
    END_ITEMS.length,
    "the end menu's rectangles, one per item (specs/controls.md, The pointer)",
  );

  const after = await hoverRect(h, rects[TITLE]);
  captureStill(h, "hover");

  assertEqual(after.screen, "fallen", "the screen the hover left");
  assertEqual(
    after.menuIndex,
    TITLE,
    "menuIndex with the pointer inside TITLE's rectangle (specs/controls.md, Hover)",
  );
});
