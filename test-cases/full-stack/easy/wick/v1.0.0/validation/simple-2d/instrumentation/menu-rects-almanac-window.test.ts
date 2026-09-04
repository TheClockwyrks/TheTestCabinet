// instrumentation/menu-rects-almanac-window — on the almanac's TOOLS tab
// scrolled to almanacScroll 1, `menuRects()` reports ALMANAC_ROWS (10)
// rectangles, the first of them the row of the entry at menuIndex 1, so the
// rectangle at position i belongs to the entry at menuIndex almanacScroll + i.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, Menus: "`almanac`
// reports one rectangle per visible entry row, in list order from
// `almanacScroll` and at most `ALMANAC_ROWS` of them, so a tab holding fewer
// entries than that reports one per entry." specs/controls.md, The pointer: "On
// `almanac` it is the visible entry rows, at most `ALMANAC_ROWS` of them, and
// the rectangle at position `i` belongs to the entry at `menuIndex`
// `almanacScroll + i`."
//
// WHAT DECIDES WHICH ENTRY A RECTANGLE BELONGS TO. The specification fixes that
// correspondence in exactly one observable way: "The pointer inside the
// rectangle of the item at `menuIndex` `i`, with `menuIndex` not `i`, sets
// `menuIndex` to `i`" (specs/controls.md). So the rectangle is asked what it
// belongs to by resting the pointer in it and reading `menuIndex` back. Nothing
// is assumed about where a build draws a row, how wide it makes the band, or
// where in it the name sits: the reading names the rectangle and the game names
// the entry. That the pointer moves a highlight AT ALL is a pointer point; what
// this decides is which entry the reading's first rectangle stands for once the
// list has scrolled, which is the window rule and nothing else.
//
// THE POSE. `setScreen('almanac')` opens the TOOLS tab, whose 16 entries are
// more than the 10 rows the list shows. ALMANAC_ROWS presses of `down` carry
// the highlight to entry ALMANAC_ROWS, one past the last visible row, and
// "`almanacScroll` follows the highlight ... the greater of that and
// `menuIndex − ALMANAC_ROWS + 1`" (specs/ui.md) puts the scroll at exactly 1.
// The pose is asserted before the claim is read, so a build whose almanac
// cannot be walked reports that rather than a broken window.
//
// The hover is read on the FIRST rectangle, where the offset shows plainest: at
// scroll 1 it stands for entry 1, and a build reporting the list from its start
// instead of from `almanacScroll` would answer 0. A second rectangle is asked
// after it, so the rule is read as an offset across the window rather than at
// one position. Neither hover moves the scroll: `min(almanacScroll, menuIndex)`
// is already `almanacScroll` for a `menuIndex` inside the window.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  hoverRect,
  menuRects,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { assertRects } from "./rects";

/** The tab the almanac opens on, and the entries specs/ui.md gives it. */
const TAB = "TOOLS";
const ENTRIES = ALMANAC_ENTRIES[TAB].length;

/** `down` carried this far leaves the highlight one row past the window. */
const STEPS = ALMANAC_ROWS;

/** `max(0, STEPS − ALMANAC_ROWS + 1)`, held below `ENTRIES − ALMANAC_ROWS`. */
const SCROLL = Math.min(
  Math.max(0, STEPS - ALMANAC_ROWS + 1),
  Math.max(0, ENTRIES - ALMANAC_ROWS),
);

/** The rectangle a second reading is taken from, inside the window. */
const SECOND = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports the visible window, its first rectangle standing for entry almanacScroll", async () => {
  const entered = poseScene(h, "almanac");
  assertEqual(entered.almanacTab, 0, "the almanac opens on the first tab");
  assertGreaterThan(ENTRIES, ALMANAC_ROWS, "the tab holds more than it shows");
  assertGreaterThan(SCROLL, 0, "the pose scrolls the list");

  for (let step = 0; step < STEPS; step += 1) await tap(h, "ArrowDown");
  const scrolled = h.snapshot();
  assertEqual(scrolled.menuIndex, STEPS, "menuIndex the presses reached");
  assertEqual(scrolled.almanacScroll, SCROLL, "almanacScroll the presses left");

  const rects = menuRects(h);
  await h.tick(1);
  captureStill(h, "window");

  assertRects(rects, ALMANAC_ROWS, "menuRects() on the scrolled almanac");

  const first = await hoverRect(h, rects[0]);
  assertEqual(
    first.menuIndex,
    SCROLL,
    "the first rectangle belongs to the entry at almanacScroll + 0",
  );
  assertEqual(
    first.almanacScroll,
    SCROLL,
    "almanacScroll across a hover inside the window",
  );

  const window = menuRects(h);
  const second = await hoverRect(h, window[SECOND]);
  assertEqual(
    second.menuIndex,
    SCROLL + SECOND,
    `the rectangle at ${SECOND} belongs to the entry at almanacScroll + ${SECOND}`,
  );
});
