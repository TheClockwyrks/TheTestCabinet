// Wick — instrumentation/tab-rects-reported: on `almanac`, `tabRects()`
// reports one rectangle per tab, in `ALMANAC_TABS` order.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `tabRects()`: "Reports the rectangles of the almanac's tab bar on
// `almanac`, one per tab in `ALMANAC_TABS` order, each a plain object carrying
// `x`, `y`, `width`, and `height` in the same stage coordinates ... Each
// rectangle is the area a click selects that tab inside, and it meets no
// rectangle `menuRects` reports on that screen." `specs/ui.md`, `almanac`,
// names the bar: "the tab bar `ALMANAC_TABS` (`TOOLS`, `TRINKETS`, `ENEMIES`,
// `PICKUPS`, in that order)".
//
// WHAT IS READ, AND WHY. The count, the four fields of every rectangle, that
// no two of them meet and that none meets an entry row, and which tab each
// rectangle belongs to. Belonging is read off the frame: `specs/ui.md` draws
// the bar as the four names of `ALMANAC_TABS`, so the tab a rectangle is for
// is the one whose name the frame drew inside it. Neither the geometry nor the
// pointer decides it — `specs/ui.md` fixes no layout for the bar beyond its
// being across the top, and a build hit-testing a click against the very list
// it reports agrees with itself whatever order that list is in.
//
// THE DRIVE. `setScreen("almanac")`, which `specs/instrumentation.md` makes
// the same entry as confirming `THE ALMANAC`, and one frame read for the names
// it drew.
//
// THE TOLERANCE. Each name is matched as a substring, ignoring case, so a
// build that writes a marker beside the shown tab reads the same. The count is
// the length of `ALMANAC_TABS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertFalse, assertLength } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  poseScreen,
  tabRects,
  textDraws,
  type Harness,
} from "../harness";
import {
  assertDisjoint,
  assertLabelledInOrder,
  assertRectShape,
  overlap,
} from "./rects";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports one rectangle per tab, in ALMANAC_TABS order, clear of the entry rows", async () => {
  poseScreen(h, "almanac");
  const tabs = tabRects(h);
  assertLength(tabs, ALMANAC_TABS.length, "tabRects() on almanac");
  tabs.forEach((rect, i) => {
    assertRectShape(rect, `tabRects() on almanac, rectangle ${i}`);
  });
  assertDisjoint(tabs, "tabRects() on almanac");

  const rows = menuRects(h);
  tabs.forEach((tab, i) => {
    rows.forEach((row, j) => {
      assertFalse(
        overlap(tab, row),
        `tabRects() rectangle ${i} meets no menuRects rectangle (${j}) on almanac`,
      );
    });
  });

  const drawn = await h.frameDraw();
  captureStill(h, "tabs");
  assertLabelledInOrder(
    h,
    textDraws(drawn.calls),
    tabs,
    ALMANAC_TABS,
    "tabRects() reports the tab bar's rectangles in ALMANAC_TABS order",
  );
});
