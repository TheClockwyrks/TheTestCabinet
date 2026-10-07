// screens/almanac-scroll-clamped-at-end — walking the highlight to the last
// entry of a long tab stops the list at its last window of rows.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`almanacScroll`
// follows the highlight: after every move of `menuIndex` it becomes the lesser
// of `almanacScroll` and `menuIndex`, then the greater of that and
// `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`, for `count` the number of entries the tab
// holds." With the highlight on the last entry, `menuIndex − ALMANAC_ROWS + 1`
// is exactly `count − ALMANAC_ROWS`, so the window stands on its last row with
// the highlighted entry the last one shown.
//
// WHY THIS IS ITS OWN POINT. The upper bound is the OTHER end of the clamp from
// `almanac-scroll-clamped-at-top`, and the wheel reaches it by a different
// route, which is `pointer/almanac-wheel-clamped`'s. A build whose keyboard
// walk runs the window off the end of the list keeps both of those and misses
// this one.
//
// WHY THE WORLD IS POSED AS IT IS. The `TOOLS` tab, the one the almanac opens
// on, whose sixteen entries are more than the `ALMANAC_ROWS` (`10`) rows the
// list shows, so a window exists to run off. The highlight is walked there with
// REAL `ArrowDown` presses, one frame each, and the entry it reached is read
// back as the check's precondition: a build whose `down` is broken fails the
// point that owns it rather than this one.
//
// THE TOLERANCE. None: a row index is a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { almanacEntries, maxAlmanacScroll } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openAlmanac, poseEntry } from "./almanac";

/** The tab the almanac is entered on: the first, `TOOLS`. */
const TOOLS = 0;

/** How many entries that tab lists. */
const COUNT = almanacEntries(TOOLS).length;

/** The last entry of the tab, which the walk stops on. */
const LAST_ENTRY = COUNT - 1;

/** "`almanacScroll` is held between `0` and `max(0, count − ALMANAC_ROWS)`". */
const LAST_ROW = maxAlmanacScroll(COUNT);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds almanacScroll at the last window with the highlight on the last entry", async () => {
  await openAlmanac(h);

  const out = await poseEntry(h, LAST_ENTRY);
  await captureStill(h, "end");

  assertEqual(out.screen, "almanac", "the screen the walk left");
  assertEqual(
    out.almanacScroll,
    LAST_ROW,
    "almanacScroll with the highlight on the last entry of the TOOLS list (specs/ui.md)",
  );
});
