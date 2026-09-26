// pointer/almanac-wheel-scrolls — a row's worth of wheel travel moves the
// almanac's list by one row.
//
// WHAT THIS DECIDES. One thing: on the almanac's `TOOLS` tab with
// `almanacScroll` `0`, one frame carrying `WHEEL_ROW` (`100`) stage units of
// downward wheel travel leaves `almanacScroll` at `1`. That the highlight is
// untouched by the same travel, and that travel past the end of the list is
// held, are their own points.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 3: "On `almanac`, wheel travel moves
//   the list. A frame's travel is that frame's wheel deltas summed in stage
//   units, divided by `WHEEL_ROW` (`100`) and truncated toward zero to give the
//   number of rows `almanacScroll` moves, downward travel moving it toward the
//   end of the list."
//   specs/controls.md (The pointer): "wheel travel is read in those same
//   units", the stage's own.
//   specs/ui.md (`almanac`): "`menuIndex`, `almanacTab`, and `almanacScroll`
//   are `0` on arriving", and the `TOOLS` tab lists "the ten of
//   `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", sixteen entries, so a
//   list showing `ALMANAC_ROWS` (`10`) of them has somewhere to go.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacScroll` off the snapshot
// after the one frame the travel falls on. `WHEEL_ROW` units is exactly one row
// by the spec's own division, so the answer the rule fixes is `1`: a build that
// scrolled by a pixel, by a page, or not at all reads something else.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does: the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md); then
// one wheel event of `WHEEL_ROW` units of downward travel and the one frame
// that reads it, the rules being "applied on every frame, after that frame's
// press edges and before its update" (specs/controls.md). The harness turns the
// wheel in stage units and undoes the fit on the way in, so what the frame sums
// is the figure the spec names.
//
// THE TOLERANCE. None: a row index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS, WHEEL_ROW } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  wheelBy,
  type Harness,
} from "../harness";

let h: Harness;

/** One row of travel: `WHEEL_ROW` stage units downward. */
const ROWS = 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises the almanac's first visible row by one on a row of downward travel", async () => {
  const before = poseScene(h, "almanac");
  assertEqual(before.screen, "almanac", "the screen the wheel turns on");
  assertEqual(before.almanacTab, 0, "the tab the almanac is showing, TOOLS");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");
  assertGreaterThan(
    ALMANAC_ENTRIES.TOOLS.length,
    ALMANAC_ROWS,
    "the TOOLS entries, which must outnumber the rows the list shows for the list to move",
  );

  const after = await wheelBy(h, ROWS);
  captureStill(h, "scrolled");

  assertEqual(after.screen, "almanac", "the screen the wheel left the game on");
  assertEqual(
    after.almanacScroll,
    ROWS,
    `the first visible row after ${ROWS * WHEEL_ROW} stage units of downward travel, which WHEEL_ROW divides into ${ROWS} row`,
  );
});
