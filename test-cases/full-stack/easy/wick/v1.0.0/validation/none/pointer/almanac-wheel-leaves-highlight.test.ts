// pointer/almanac-wheel-leaves-highlight — the wheel moves the list and leaves
// the entry highlight where it is.
//
// WHERE THE THRESHOLD COMES FROM. specs/controls.md ("The pointer"), rule 3:
// "A frame's travel is that frame's wheel deltas summed in stage units, divided
// by `WHEEL_ROW` (`100`) and truncated toward zero to give the number of rows
// `almanacScroll` moves ... `menuIndex` is untouched by the wheel."
// specs/ui.md ("`almanac`") gives the `TOOLS` tab sixteen entries, "the ten of
// `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", so one row of travel is
// well inside `max(0, count − ALMANAC_ROWS)`, which is `6`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` off the snapshot the
// wheeling frame left, with `almanacScroll` beside it. The scroll is the
// evidence that the wheel was read at all: a build that ignores the wheel
// entirely would keep `menuIndex` too, so the claim is only decided where the
// list moved and the highlight did not.
//
// HOW THE SCENARIO IS DRIVEN. The almanac is entered through
// `setScreen("almanac")`, which specs/instrumentation.md defines as setting
// `screen` alone, "with `menuIndex`, `almanacTab`, and `almanacScroll`
// all `0`", and the highlight is moved to the fourth entry
// with real `down` presses, which leaves `almanacScroll` at `0` because an index
// below `ALMANAC_ROWS` (`10`) needs no window to move. The wheel is Chromium's
// own, turned by exactly `WHEEL_ROW` (`100`) stage units of downward travel taken
// into the page's CSS pixels through the harness's fit. The pointer is rested on
// a point inside none of the screen's rectangles first, so the hover rule moves
// nothing while the wheel turns.
//
// THE TOLERANCE. None: two indices are exact comparisons and the travel is
// exactly one row's worth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, wheelBy, type Harness } from "../harness";
import { highlightEntry, poseAlmanac } from "./stage";

/** Where the entry highlight stands before the wheel turns. */
const HIGHLIGHTED = 3;

/** The travel the wheel is turned by, in rows: one `WHEEL_ROW` of downward travel. */
const TURNED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 3 with the list moved one row by the wheel", async () => {
  await poseAlmanac(h);
  const posed = await highlightEntry(h, HIGHLIGHTED);
  assertEqual(
    posed.almanacScroll,
    0,
    "almanacScroll with the highlight inside the first window of rows",
  );

  const turned = await wheelBy(h, TURNED);
  await captureStill(h, "held");

  assertEqual(turned.screen, "almanac", "the screen the wheel turned on");
  assertEqual(
    turned.almanacScroll,
    TURNED,
    "almanacScroll after one row of downward wheel travel",
  );
  assertEqual(
    turned.menuIndex,
    HIGHLIGHTED,
    "menuIndex after the wheel moved the list",
  );
});
