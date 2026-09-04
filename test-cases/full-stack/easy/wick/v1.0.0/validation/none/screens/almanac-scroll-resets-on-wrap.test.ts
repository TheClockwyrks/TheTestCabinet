// screens/almanac-scroll-resets-on-wrap — the wrap from the last entry to the
// first takes the list back to its top row.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`up` and `down`
// move `menuIndex` by one over the tab's entries and wrap at both ends", and
// "`almanacScroll` follows the highlight: after every move of `menuIndex` it
// becomes the lesser of `almanacScroll` and `menuIndex`, then the greater of
// that and `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`." The wrap is a move of `menuIndex` like any
// other, so the rule applies to it: at `menuIndex` `0` the lesser of the window
// and `0` is `0`, and `0 − ALMANAC_ROWS + 1` is below it, so the window is `0`
// however far down the list the wrap came from.
//
// WHY THIS IS ITS OWN POINT. The wrap of the HIGHLIGHT is
// `almanac-entry-wraps-at-bottom`'s, and the window returning to the top under
// a walk back up is `almanac-scroll-clamped-at-top`'s. A build that wraps the
// highlight but leaves the window where the walk pushed it shows the first
// entry highlighted off a list scrolled to its end, and keeps both of those
// points while missing this one.
//
// WHY THE WORLD IS POSED AS IT IS. The `TOOLS` tab, whose sixteen entries are
// more than the `ALMANAC_ROWS` (`10`) rows the list shows, so the window is off
// its top row when the wrap happens. That is read back as the check's
// precondition, because a wrap from a list that never scrolled would decide
// nothing. Every press is a REAL key through Chromium's input pipeline, held
// across exactly one frame.
//
// THE TOLERANCE. None: two whole indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { almanacEntries } from "../constants";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { openAlmanac, poseEntry } from "./almanac";

/** The tab the almanac is entered on: the first, `TOOLS`. */
const TOOLS = 0;

/** The last entry of that tab, the one the wrapping press is made from. */
const LAST_ENTRY = almanacEntries(TOOLS).length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 0 with almanacScroll 0 on the down that wraps", async () => {
  await openAlmanac(h);
  const out = await poseEntry(h, LAST_ENTRY);
  assertGreaterThan(
    out.almanacScroll,
    0,
    "the window the walk carried off the top of the list",
  );

  const wrapped = await pressDown(h);
  await captureStill(h, "wrapped");

  assertEqual(wrapped.screen, "almanac", "the screen the wrapping press left");
  assertEqual(wrapped.menuIndex, 0, "menuIndex after the wrapping press");
  assertEqual(
    wrapped.almanacScroll,
    0,
    "almanacScroll with the highlight wrapped to the first entry (specs/ui.md)",
  );
});
