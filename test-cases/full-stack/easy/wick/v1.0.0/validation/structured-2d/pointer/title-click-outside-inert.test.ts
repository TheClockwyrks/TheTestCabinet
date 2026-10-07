// Wick — pointer/title-click-outside-inert: a click inside no rectangle takes
// no item.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 2, Click: "A primary press edge inside no rectangle does nothing."
// `specs/ui.md`, "`title`", puts `menuIndex` at `0` on arriving, so a title
// screen the click left alone reads `title` with `menuIndex` `0`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `screen` and `menuIndex` after
// the clicking frame. A build that treats any press on the stage as a confirm
// of the highlighted item lights the lamp here and reads `playing`; a build
// that resolves the press to the nearest item rather than to the rectangle it
// is inside moves the highlight and fails on the index.
//
// THE DRIVE. `reset` to the title screen, the menu's own rectangles read off
// `menuRects`, and a primary press and release at a stage point at least
// `MENU_CLEARANCE` units outside every one of them, before the frame that reads
// the edge. The point is SEARCHED FOR against what the build reported: the
// specification fixes no layout, so a point named here would be a coordinate
// read off one build rather than a rule.
//
// THE TOLERANCE. The clearance, and nothing else: `MENU_CLEARANCE` stage units
// between the point and the nearest rectangle, which leaves room for a hit area
// a little larger than the rectangle reported and for the rounding between
// stage units and device pixels.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickAt,
  createHarness,
  menuRects,
  type Harness,
} from "../harness";
import { outsidePoint } from "./pointing";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds title with menuIndex 0 after a click inside no rectangle", async () => {
  h.reset();
  const before = h.snapshot();
  assertEqual(before.screen, "title", "the screen the click is made on");
  assertEqual(before.menuIndex, 0, "the highlighted item before the click");

  const rects = menuRects(h);
  assertLength(
    rects,
    TITLE_ITEMS.length,
    "the title menu's rectangles, one per item (specs/controls.md, The pointer)",
  );
  const empty = outsidePoint(rects);

  const after = await clickAt(h, empty.x, empty.y);
  captureStill(h, "outside");

  assertEqual(
    after.screen,
    "title",
    "the screen after a click inside no rectangle (specs/controls.md, Click)",
  );
  assertEqual(
    after.menuIndex,
    0,
    "menuIndex after a click inside no rectangle",
  );
});
