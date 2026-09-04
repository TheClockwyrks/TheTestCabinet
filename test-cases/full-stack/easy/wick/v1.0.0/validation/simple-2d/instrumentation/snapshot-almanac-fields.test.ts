// instrumentation/snapshot-almanac-fields — on `almanac`, `almanacTab` reads
// the tab the screen shows and `almanacScroll` reads the list's first visible
// row, both read back after a tab change and after the highlight has scrolled
// the list.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// "`almanacTab`: the tab the almanac is showing" and "`almanacScroll`: the
// almanac list's first visible row", both "beside `menuIndex`, outside `run`".
// specs/ui.md (`almanac`) fixes what each holds: "`menuIndex`, `almanacTab`,
// and `almanacScroll` are `0` on arriving"; "`left` and `right` move
// `almanacTab` by one over `ALMANAC_TABS`, wrap at both ends, and set
// `menuIndex` and `almanacScroll` to `0`"; and "`almanacScroll` follows the
// highlight: after every move of `menuIndex` it becomes the lesser of
// `almanacScroll` and `menuIndex`, then the greater of that and
// `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`".
//
// THE DRIVE. The almanac is reached through `setScreen`, and then posed with
// real key edges, because no operation of the surface sets either field: what
// the almanac HOLDS is the only thing they can be read off. One `right` moves
// the tab, and `ALMANAC_ROWS` presses of `down` on the TOOLS tab, which holds
// more entries than the list shows, carry the highlight one row past the window
// and so move the scroll by exactly one row. What each key press is WORTH
// belongs to the screens points about the almanac's navigation; what this
// decides is that the two fields report those positions back.
//
// THE TOLERANCE is exactness: both fields are whole indices the specification
// names, not measured figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";

/** The tab the list scrolls on: the first holding more entries than it shows. */
const SCROLLING_TAB = ALMANAC_TABS.findIndex(
  (tab) => ALMANAC_ENTRIES[tab].length > ALMANAC_ROWS,
);

/** The highlight one row past the window, which is one row of scroll. */
const STEPS = ALMANAC_ROWS;

/** `max(0, menuIndex − ALMANAC_ROWS + 1)` from `almanacScroll` 0, so 1. */
const SCROLLED = Math.max(0, STEPS - ALMANAC_ROWS + 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads the almanac's tab and its first visible row back", async () => {
  const entered = poseScene(h, "almanac");
  assertEqual(entered.almanacTab, 0, "almanacTab on arriving");
  assertEqual(entered.almanacScroll, 0, "almanacScroll on arriving");

  // A tab change: `right` moves `almanacTab` by one and resets the scroll.
  const moved = await tap(h, "ArrowRight");
  assertEqual(moved.almanacTab, 1, "almanacTab after one right");
  assertEqual(moved.almanacScroll, 0, "almanacScroll a tab change resets");

  // Back to the tab whose list is longer than the window it is shown through.
  for (let step = ALMANAC_TABS.length - 1; step > SCROLLING_TAB; step -= 1) {
    await tap(h, "ArrowRight");
  }
  const wrapped = h.snapshot();
  assertEqual(wrapped.almanacTab, SCROLLING_TAB, "almanacTab back on the tab");
  assertEqual(wrapped.almanacScroll, 0, "almanacScroll on reaching the tab");

  // The highlight carried one row past the window it is shown through.
  for (let step = 0; step < STEPS; step += 1) await tap(h, "ArrowDown");
  const scrolled = h.snapshot();
  await h.tick(1);
  captureStill(h, "fields");

  assertEqual(scrolled.menuIndex, STEPS, "menuIndex the presses reached");
  assertEqual(
    scrolled.almanacTab,
    SCROLLING_TAB,
    "almanacTab across the moves",
  );
  assertEqual(
    scrolled.almanacScroll,
    SCROLLED,
    "almanacScroll: the list's first visible row",
  );
});
