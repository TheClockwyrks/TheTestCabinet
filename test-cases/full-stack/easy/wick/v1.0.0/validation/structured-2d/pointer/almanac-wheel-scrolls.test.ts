// Wick — pointer/almanac-wheel-scrolls: a row of downward wheel travel scrolls
// the almanac's list by one row.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/controls.md`, The pointer,
// rule 3, The wheel: "On `almanac`, wheel travel moves the list. A frame's
// travel is that frame's wheel deltas summed in stage units, divided by
// `WHEEL_ROW` (`100`) and truncated toward zero to give the number of rows
// `almanacScroll` moves, downward travel moving it toward the end of the
// list". The same section reads the travel "in the stage's own coordinates,
// `0` to `STAGE_W` across and `0` to `STAGE_H` down", so one row is exactly
// `WHEEL_ROW` stage units of downward travel.
//
// WHY THE TOOLS TAB. `specs/ui.md` gives it sixteen entries, "the ten of
// `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", against a window of
// `ALMANAC_ROWS` (`10`), so `almanacScroll` is held between `0` and `6` and a
// single row of travel is well inside that. The list has somewhere to go.
//
// THE DRIVE. `setScreen("almanac")`, which `specs/instrumentation.md` makes
// enter the almanac "exactly as confirming `THE ALMANAC` does: the idle run,
// `menuIndex` `0`, `almanacTab` `0`, `almanacScroll` `0`", then one frame
// carrying exactly `WHEEL_ROW` stage units of downward travel.
//
// THE TOLERANCE. None: the specification divides by `WHEEL_ROW` and truncates,
// so one row of travel is one row of scroll exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  wheelBy,
  type Harness,
} from "../harness";

/** The rows of downward travel this check turns the wheel by. */
const ONE_ROW = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanacScroll 1 after one row of downward wheel travel", async () => {
  h.reset();
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.screen, "almanac", "the screen the wheel is turned on");
  assertEqual(opened.almanacTab, 0, "the tab the almanac opens on, TOOLS");
  assertEqual(opened.almanacScroll, 0, "the list's first visible row");

  const after = await wheelBy(h, ONE_ROW);
  captureStill(h, "scrolled");

  assertEqual(after.screen, "almanac", "the screen the wheel left");
  assertEqual(
    after.almanacScroll,
    ONE_ROW,
    "the list's first visible row after one row of travel (specs/controls.md, The wheel)",
  );
});
