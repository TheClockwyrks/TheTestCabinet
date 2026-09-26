// Wick — instrumentation/menu-rects-almanac-window: on the almanac's `TOOLS` tab
// scrolled to `almanacScroll` `1`, `menuRects()` reports `ALMANAC_ROWS` (`10`)
// rectangles and the first of them is the row of the entry at `menuIndex` `1`,
// so the rectangle at position `i` belongs to the entry at `menuIndex`
// `almanacScroll + i`.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — `menuRects()`):
// "`almanac` reports one rectangle per visible entry row, in list order from
// `almanacScroll` and at most `ALMANAC_ROWS` of them, so a tab holding fewer
// entries than that reports one per entry", and "Each rectangle is the area a
// hover or a click selects that item inside". specs/controls.md ("The
// pointer"): "On `almanac` it is the visible entry rows, at most `ALMANAC_ROWS`
// of them, and the rectangle at position `i` belongs to the entry at `menuIndex`
// `almanacScroll + i`", with the hover rule "The pointer inside the rectangle of
// the item at `menuIndex` `i`, with `menuIndex` not `i`, sets `menuIndex` to
// `i`". specs/ui.md: the `TOOLS` tab holds "the ten of `BASE_WEAPON_IDS`, then
// the six of `EVOLUTION_IDS`", sixteen against `ALMANAC_ROWS` (`10`), so its
// list has rows out of sight.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. The count answers how much of the
// list the window holds. Which entry the first rectangle belongs to is read the
// only way the specification defines it, by resting the pointer inside it and
// reading `menuIndex` back: the rectangle IS the area that selects its entry, so
// the entry it selects is the entry it belongs to. Where on the stage the row
// was drawn is not read; specs/ui.md fixes "no layout".
//
// WHY THE WORLD IS POSED AS IT IS. The highlight is walked `ALMANAC_ROWS` steps
// down the sixteen-entry `TOOLS` tab from the top. The follow rule —
// "`almanacScroll` ... becomes the lesser of `almanacScroll` and `menuIndex`,
// then the greater of that and `menuIndex − ALMANAC_ROWS + 1`" — leaves the
// scroll at `0` for the first nine steps and at `1` on the tenth, which is the
// scrolled list this check needs, and leaves `menuIndex` at `10`, well away from
// the `1` the hover must produce. A window read off the bare position rather
// than off `almanacScroll` answers `0` there and fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { ALMANAC_ROWS, almanacEntries } from "../constants";
import {
  captureStill,
  createHarness,
  menuRects,
  poseScreen,
  pressDown,
  type Harness,
} from "../harness";
import { assertBelongsTo, assertRects } from "./rects";

/** The tab the check reads: `TOOLS`, the first, whose sixteen entries outrun the window. */
const TAB = 0;

/** Entry moves down that tab: one past the last visible row, which scrolls the list by one. */
const MOVES = ALMANAC_ROWS;

/** Where the follow rule leaves the list after those moves. */
const SCROLL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the visible window of rows, in list order from almanacScroll", async () => {
  const opened = await poseScreen(h, "almanac");
  assertEqual(opened.almanacTab, TAB, "the tab the almanac opens on");
  assertTrue(
    almanacEntries(TAB).length > ALMANAC_ROWS,
    "the TOOLS tab holding more entries than the list shows at once",
  );

  for (let move = 0; move < MOVES; move += 1) await pressDown(h);
  const scrolled = await h.snapshot();
  assertEqual(scrolled.menuIndex, MOVES, "the entry the highlight walked to");
  assertEqual(scrolled.almanacScroll, SCROLL, "the list's first visible row");

  const rects = await menuRects(h);
  await captureStill(h, "window");

  assertLength(rects, ALMANAC_ROWS, "menuRects() on the scrolled TOOLS tab");
  assertRects(rects, "menuRects() on almanac");
  await assertBelongsTo(
    h,
    rects,
    0,
    SCROLL,
    "the entry menuRects()[0] belongs to, almanacScroll + 0",
  );
});
