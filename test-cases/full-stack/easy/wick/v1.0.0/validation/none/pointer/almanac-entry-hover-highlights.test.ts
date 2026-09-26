// pointer/almanac-entry-hover-highlights — the pointer resting on the third
// visible row moves the almanac's entry highlight onto it.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"): "On
// `almanac` it is the visible entry rows, at most `ALMANAC_ROWS` of them, and
// the rectangle at position `i` belongs to the entry at `menuIndex`
// `almanacScroll + i`", and rule 1: "The pointer inside the rectangle of the
// item at `menuIndex` `i`, with `menuIndex` not `i`, sets `menuIndex` to `i`".
// specs/ui.md ("`almanac`"): "`menuIndex`, `almanacTab`, and `almanacScroll` are
// `0` on arriving", so with `almanacScroll` `0` the third row is the entry at
// `menuIndex` `2`. The `TOOLS` tab holds "the ten of `BASE_WEAPON_IDS`, then the
// six of `EVOLUTION_IDS`", sixteen entries, and "The list shows `ALMANAC_ROWS`
// (`10`) entries at a time", so ten rows are showing.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot, with
// `almanacScroll` read beside it: the window the rectangle is resolved through
// is what makes the third rectangle the third ENTRY, so a check that did not
// establish the scroll would not know which entry it aimed at.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`". `menuRects()` reports where this build drew the ten
// visible rows; the pointer is moved to the middle of the third, and exactly one
// frame runs after the move, because the pointer rules are "applied on every
// frame".
//
// THE TOLERANCE. None: a screen name and two indices are exact comparisons, and
// the aim is inside the rectangle by construction.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { almanacEntries, visibleAlmanacRows } from "../constants";
import { captureStill, createHarness, hoverAt, type Harness } from "../harness";
import { assertHighlight, menuPoints, poseAlmanac } from "./stage";

/** The tab the almanac is entered on: the first, `TOOLS`. */
const TOOLS = 0;

/** The rows the `TOOLS` tab shows from `almanacScroll` `0`. */
const ROWS = visibleAlmanacRows(almanacEntries(TOOLS).length, 0);

/** The row the pointer rests on: the third the list shows. */
const HOVERED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 2 with the pointer inside the third visible row", async () => {
  await poseAlmanac(h);
  const points = await menuPoints(
    h,
    ROWS,
    "for the almanac's visible entry rows",
  );

  const hovered = await hoverAt(h, points[HOVERED]!);
  await captureStill(h, "hover");

  assertHighlight(
    hovered,
    "almanac",
    HOVERED,
    "under a pointer inside the third visible entry row",
  );
  assertEqual(
    hovered.almanacScroll,
    0,
    "almanacScroll the third row is counted from",
  );
});
