// Wick — instrumentation/menu-rects-almanac-window: on `almanac`,
// `menuRects()` reports the VISIBLE entry rows, so the rectangle at position
// `i` belongs to the entry at `menuIndex` `almanacScroll + i`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Menus", `menuRects()`: "`almanac` reports one rectangle per visible entry
// row, in list order from `almanacScroll` and at most `ALMANAC_ROWS` of them",
// and "Each rectangle is the area a hover or a click selects that item
// inside". `specs/controls.md`, The pointer: "On `almanac` it is the visible
// entry rows, at most `ALMANAC_ROWS` of them, and the rectangle at position
// `i` belongs to the entry at `menuIndex` `almanacScroll + i`."
// `specs/ui.md`, `almanac`: the `TOOLS` tab holds "the ten of
// `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen entries, and
// "The list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at the
// entry at `almanacScroll`".
//
// WHAT IS READ, AND WHY. The number of rectangles, and which entry each of
// them belongs to, with the list scrolled off its top. The window is what
// every almanac hover and click rests on, so a build that reported one
// rectangle per ENTRY, or reported the window but numbered it from `0` rather
// than from `almanacScroll`, has to be told apart here. Belonging is read off
// the frame: "Each row shows its entry's name" (`specs/ui.md`, `almanac`), and
// "Each item the menu currently shows occupies a rectangle on the stage"
// (`specs/controls.md`), so the entry that occupies a rectangle is the one
// whose name the frame drew inside it. Neither the geometry nor the pointer
// decides it — `specs/ui.md` fixes no layout, and a build hit-testing the
// pointer against the list it reports agrees with itself whatever window that
// list holds.
//
// THE DRIVE. `setScreen("almanac")`, which opens on `TOOLS` with `menuIndex`
// and `almanacScroll` at `0`, then `ALMANAC_ROWS` `down` presses. Sixteen
// entries hold the highlight off the wrap, and the scroll rule
// ("`almanacScroll` ... becomes the lesser of `almanacScroll` and `menuIndex`,
// then the greater of that and `menuIndex − ALMANAC_ROWS + 1`",
// `specs/ui.md`) leaves the window's first row at `1`. One frame is then read
// for the names it drew.
//
// THE TOLERANCE. Each name is matched as a substring, ignoring case, so a
// build that writes a marker beside the highlighted row reads the same. The
// row count and the scroll are whole numbers the specification names exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  ALMANAC_ENTRY_COUNTS,
  ALMANAC_ENTRY_NAMES,
  ALMANAC_ROWS,
} from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  poseScreen,
  tap,
  textDraws,
  type Harness,
} from "../harness";
import {
  assertDisjoint,
  assertLabelledInOrder,
  assertRectShape,
} from "./rects";

/** Where the window starts once the highlight sits on `menuIndex` `ALMANAC_ROWS`. */
const POSED_SCROLL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports ALMANAC_ROWS rows whose position i is the entry at almanacScroll + i", async () => {
  if (!(ALMANAC_ENTRY_COUNTS.TOOLS > ALMANAC_ROWS + POSED_SCROLL)) {
    throw new Error(
      "the tools tab must hold more entries than a scrolled window",
    );
  }
  poseScreen(h, "almanac");
  for (let press = 0; press < ALMANAC_ROWS; press += 1) {
    await tap(h, "ArrowDown");
  }
  const scrolled = h.snapshot();
  assertEqual(scrolled.almanacTab, 0, "the tools tab is the one shown");
  assertEqual(
    scrolled.almanacScroll,
    POSED_SCROLL,
    "the list is scrolled off its top before the rectangles are read",
  );

  const rects = menuRects(h);
  assertLength(
    rects,
    ALMANAC_ROWS,
    "menuRects() on almanac reports the visible rows, at most ALMANAC_ROWS",
  );
  rects.forEach((rect, i) => {
    assertRectShape(rect, `menuRects() on almanac, rectangle ${i}`);
  });
  assertDisjoint(rects, "menuRects() on almanac");

  const drawn = await h.frameDraw();
  captureStill(h, "window");
  assertLabelledInOrder(
    h,
    textDraws(drawn.calls),
    rects,
    ALMANAC_ENTRY_NAMES.TOOLS.slice(POSED_SCROLL, POSED_SCROLL + ALMANAC_ROWS),
    "menuRects() on almanac reports the rectangle at position i for the entry at menuIndex almanacScroll + i",
  );
});
