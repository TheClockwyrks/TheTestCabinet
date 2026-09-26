// instrumentation/menu-item-rect-reports-the-entry-region — the reading answers
// the region the entry is actually selected from.
//
// `specs/instrumentation.md` § Readings: "`menuItemRect(index)` The hit region
// of entry `index` of the menu the screen showing carries, as `{ x, y, w, h
// }`", and "`x` and `y` are the region's top-left corner in logical stage units
// and `w` and `h` its size: the region a pointer selects that entry from and a
// contact takes it in (`specs/ui.md`)."
//
// TWO HALVES, AND THE SECOND IS THE ONE THAT MATTERS. A build could answer any
// pair of rectangles and satisfy a check that only read the shape of them, so
// this check reads the shape AND then drives the pointer into the middle of
// each one in turn and asserts that the highlight lands on the entry the region
// was reported for. That is what makes the reading the layout rather than a
// number.
//
// The title screen is used because `specs/ui.md` fixes its menu at two entries,
// so both regions can be reported and both driven; the regions are also read as
// distinct, since two entries reported at one rectangle would let the second
// drive pass by accident.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { STAGE_H, STAGE_W, TITLE_ITEMS } from "../constants";
import {
  createHarness,
  menuRect,
  pointerOntoItem,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports each entry's region, and the pointer selects the entry there", async () => {
  await h.debug.setScreen("title");

  const rects = [];
  for (let i = 0; i < TITLE_ITEMS.length; i += 1) {
    rects.push(await menuRect(h, i));
  }

  rects.forEach((rect, i) => {
    assertTrue(
      rect.w > 0 && rect.h > 0,
      `a region with a positive width and height for title entry ${i} ` +
        `(specs/instrumentation.md), read as ${JSON.stringify(rect)}`,
    );
    assertTrue(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.w <= STAGE_W &&
        rect.y + rect.h <= STAGE_H,
      `title entry ${i}'s region inside the logical stage, which is where ` +
        `the entry is drawn, read as ${JSON.stringify(rect)}`,
    );
  });

  const first = rects[0];
  const second = rects[1];
  assertTrue(
    first !== undefined &&
      second !== undefined &&
      (first.x !== second.x ||
        first.y !== second.y ||
        first.w !== second.w ||
        first.h !== second.h),
    "two different regions for the title menu's two entries, so a pointer can " +
      "tell them apart (specs/ui.md)",
  );

  try {
    // The reading is the layout: the pointer put in the middle of each reported
    // region selects the entry that region was reported for.
    for (let i = TITLE_ITEMS.length - 1; i >= 0; i -= 1) {
      await pointerOntoItem(h, i);
      assertEqual(
        (await h.snapshot()).menuIndex,
        i,
        `the highlight after the pointer was moved into the region reported for ` +
          `title entry ${i} (specs/ui.md)`,
      );
    }
  } finally {
    // In a `finally`, so a check that fails inside the sweep still leaves
    // the picture that shows why.
    await h.capture("state", "The driven state this point decides");
  }
});
