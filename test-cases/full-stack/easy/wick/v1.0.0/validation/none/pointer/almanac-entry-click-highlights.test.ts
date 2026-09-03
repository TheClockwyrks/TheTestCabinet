// pointer/almanac-entry-click-highlights — a click on an almanac entry moves the
// highlight and nothing else.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 2: "A
// primary press edge inside the rectangle of the item at `menuIndex` `i` sets
// `menuIndex` to `i` ... and then takes that item exactly as `confirm` on it
// does ... On `almanac` an entry carries no `confirm`, so a click on an entry
// only moves the highlight". specs/controls.md ("What each screen reads") leaves
// `confirm` off the `almanac` row, and states "so `confirm` on `almanac` changes
// nothing". specs/ui.md ("`almanac`"): "`menuIndex`, `almanacTab`, and
// `almanacScroll` are `0` on arriving", so with `almanacScroll` `0` the third
// row is the entry at `menuIndex` `2`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` and `screen` off the
// snapshot the clicking frame left. The screen is the half of the claim that
// separates the almanac from every other menu: a build that treated an entry as
// a confirmable item would leave `almanac` on the click.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as "exactly as
// confirming `THE ALMANAC` does". `menuRects()` reports where this build drew
// the ten visible rows of the `TOOLS` tab, "the ten of `BASE_WEAPON_IDS`, then
// the six of `EVOLUTION_IDS`" shown "`ALMANAC_ROWS` (`10`) entries at a time",
// and the primary button is pressed at the middle of the third, with exactly one
// frame between press and release.
//
// THE TOLERANCE. None: a screen name and two indices are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { almanacEntries, visibleAlmanacRows } from "../constants";
import { captureStill, clickAt, createHarness, type Harness } from "../harness";
import { assertHighlight, menuPoints, poseAlmanac } from "./stage";

/** The tab the almanac is entered on: the first, `TOOLS`. */
const TOOLS = 0;

/** The rows the `TOOLS` tab shows from `almanacScroll` `0`. */
const ROWS = visibleAlmanacRows(almanacEntries(TOOLS).length, 0);

/** The row the click lands in: the third the list shows. */
const CLICKED = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 2 with the screen still almanac after a click on the third row", async () => {
  await poseAlmanac(h);
  const points = await menuPoints(
    h,
    ROWS,
    "for the almanac's visible entry rows",
  );

  const clicked = await clickAt(h, points[CLICKED]!);
  await captureStill(h, "clicked");

  assertHighlight(
    clicked,
    "almanac",
    CLICKED,
    "after a click inside the third visible entry row",
  );
  assertEqual(
    clicked.almanacScroll,
    0,
    "almanacScroll the third row is counted from",
  );
});
