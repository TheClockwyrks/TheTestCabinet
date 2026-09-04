// pointer/almanac-wheel-clamped — wheel travel past the end of the list stops at
// the last window of rows.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 3:
// "the remainder is discarded, and `almanacScroll` is held within `0` and
// `max(0, count − ALMANAC_ROWS)`, `count` being the number of entries the shown
// tab holds". specs/ui.md ("`almanac`") gives the `TOOLS` tab "the ten of
// `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen entries, and
// "The list shows `ALMANAC_ROWS` (`10`) entries at a time", so the bound is
// `16 − 10`, which is `6`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacScroll` off the snapshot
// the wheeling frame left, against the bound computed from the tab's own entry
// count and `ALMANAC_ROWS`. A build that let the list run off its end reads
// higher; one that stopped early reads lower.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as "exactly as
// confirming `THE ALMANAC` does", with `almanacScroll` `0`. The wheel is then
// turned by forty rows' worth of downward travel in one frame. Forty is a DRIVE
// LENGTH rather than a threshold: any travel past the tab's sixteen entries
// answers the same bound, and forty is comfortably past it whatever the shown
// tab holds. The pointer is rested on a point inside none of the screen's
// rectangles first, so the hover rule moves nothing while the wheel turns.
//
// THE TOLERANCE. None: `almanacScroll` is a whole number of rows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { almanacEntries, maxAlmanacScroll } from "../constants";
import { captureStill, createHarness, wheelBy, type Harness } from "../harness";
import { poseAlmanac } from "./stage";

/** The tab the almanac is entered on: the first, `TOOLS`. */
const TOOLS = 0;

/** "`almanacScroll` is held within `0` and `max(0, count − ALMANAC_ROWS)`". */
const LAST_ROW = maxAlmanacScroll(almanacEntries(TOOLS).length);

/** Rows of downward travel turned in one frame: far past the end of any tab. */
const TURNED = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds almanacScroll at the last window of rows under travel past the end", async () => {
  await poseAlmanac(h);

  const turned = await wheelBy(h, TURNED);
  await captureStill(h, "clamped");

  assertEqual(turned.screen, "almanac", "the screen the wheel turned on");
  assertEqual(
    turned.almanacScroll,
    LAST_ROW,
    "almanacScroll under wheel travel past the end of the TOOLS list",
  );
});
