// instrumentation/snapshot-reports-almanac-scroll — on `almanac`,
// `almanacScroll` reads the list's first visible row.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "Snapshot shape":
// "`almanacScroll`: the almanac list's first visible row", "beside `menuIndex`,
// outside `run`". specs/ui.md (`almanac`) fixes what it holds: "`menuIndex`,
// `almanacTab`, and `almanacScroll` are `0` on arriving", and "`almanacScroll`
// follows the highlight: after every move of `menuIndex` it becomes the lesser
// of `almanacScroll` and `menuIndex`, then the greater of that and
// `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`". `almanacTab` is
// `instrumentation/snapshot-reports-almanac-tab`'s.
//
// THE DRIVE. The almanac is reached through `setScreen`, and then posed with
// real key edges, because no operation of the surface sets the field.
// `ALMANAC_ROWS` presses of `down` on a tab holding more entries than the list
// shows carry the highlight one row past the window and so move the scroll by
// exactly one row.
//
// THE TOLERANCE is exactness: the field is a whole index the specification
// names, not a measured figure.

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

it("reads the almanac list's first visible row back", async () => {
  const entered = poseScene(h, "almanac");
  assertEqual(entered.almanacScroll, 0, "almanacScroll on arriving");

  // Onto the tab whose list is longer than the window it is shown through.
  for (let step = 0; step < SCROLLING_TAB; step += 1)
    await tap(h, "ArrowRight");
  const onTab = h.snapshot();
  assertEqual(
    onTab.almanacTab,
    SCROLLING_TAB,
    "almanacTab on reaching the tab",
  );
  assertEqual(onTab.almanacScroll, 0, "almanacScroll on reaching the tab");

  // The highlight carried one row past the window it is shown through.
  for (let step = 0; step < STEPS; step += 1) await tap(h, "ArrowDown");
  const scrolled = h.snapshot();
  await h.tick(1);
  captureStill(h, "scroll");

  assertEqual(scrolled.menuIndex, STEPS, "menuIndex the presses reached");
  assertEqual(
    scrolled.almanacScroll,
    SCROLLED,
    "almanacScroll: the list's first visible row",
  );
});
