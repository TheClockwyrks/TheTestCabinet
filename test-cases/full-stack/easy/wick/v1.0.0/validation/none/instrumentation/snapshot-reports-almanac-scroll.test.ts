// Wick — instrumentation/snapshot-reports-almanac-scroll: on `almanac`,
// `almanacScroll` reads the first entry row the list shows.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape"):
// "`almanacScroll`: the almanac list's first visible row", and "`almanacTab`
// and `almanacScroll` sit beside `menuIndex`, outside `run`". specs/state.md:
// "`almanacScroll`: the index of the first entry row the almanac's list shows.
// It is `0` on entering every screen and on every tab change." What the field
// must read comes from specs/ui.md: "`almanacScroll` follows the highlight:
// after every move of `menuIndex` it becomes the lesser of `almanacScroll` and
// `menuIndex`, then the greater of that and `menuIndex − ALMANAC_ROWS + 1`, and
// is then held between `0` and `max(0, count − ALMANAC_ROWS)`", which
// `almanacScrollFor()` restates. `almanacTab` is
// `instrumentation/snapshot-reports-almanac-tab`'s.
//
// WHY THE WORLD IS POSED AS IT IS. The highlight walks past the last visible
// row of a tab long enough to scroll — the `ENEMIES` tab holds thirteen entries
// against `ALMANAC_ROWS` (`10`), so its list moves. Every reading is exact: an
// index is a whole number, not a measurement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { ALMANAC_TABS, almanacEntries, almanacScrollFor } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  pressAction,
  pressDown,
  type Harness,
} from "../harness";

/** The tab the check scrolls: `ENEMIES`, whose list is longer than the window. */
const TAB = 2;

/** Entry moves down that tab, enough to carry the highlight past the last visible row. */
const MOVES = 11;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the list's first visible row", async () => {
  const opened = await poseScreen(h, "almanac");
  assertEqual(
    typeof opened.almanacScroll,
    "number",
    "snapshot().almanacScroll",
  );
  assertEqual(opened.almanacScroll, 0, "almanacScroll on entering the almanac");

  for (let move = 0; move < TAB; move += 1) await pressAction(h, "right");
  const changed = await h.snapshot();
  assertEqual(changed.almanacScroll, 0, "almanacScroll after a tab change");

  const count = almanacEntries(TAB).length;
  assertTrue(
    count > MOVES,
    `the ${ALMANAC_TABS[TAB]} tab holding more than ${MOVES} entries`,
  );
  let scroll = 0;
  for (let move = 1; move <= MOVES; move += 1) {
    scroll = almanacScrollFor(scroll, move, count);
  }
  for (let move = 0; move < MOVES; move += 1) await pressDown(h);
  const scrolled = await h.snapshot();
  await captureStill(h, "scroll");

  assertTrue(scroll > 0, "the pose scrolling the list off its first row");
  assertEqual(scrolled.menuIndex, MOVES, "the entry the highlight walked to");
  assertEqual(
    scrolled.almanacScroll,
    scroll,
    "almanacScroll, the list's first visible row after the highlight moved",
  );
});
