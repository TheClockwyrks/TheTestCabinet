// pointer/almanac-wheel-clamped — wheel travel past the end of the list stops
// at the end.
//
// WHAT THIS DECIDES. One thing: on the almanac's `TOOLS` tab, one frame
// carrying forty rows of downward wheel travel leaves `almanacScroll` at
// `max(0, count − ALMANAC_ROWS)`, which for the tab's sixteen entries and a
// window of ten is `6`. That a single row of travel moves the list by one is
// its own point.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 3: "the remainder is discarded, and
//   `almanacScroll` is held within `0` and `max(0, count − ALMANAC_ROWS)`,
//   `count` being the number of entries the shown tab holds", the travel itself
//   being "that frame's wheel deltas summed in stage units, divided by
//   `WHEEL_ROW` (`100`) and truncated toward zero".
//   specs/ui.md (`almanac`): the `TOOLS` tab lists "the ten of
//   `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`", and "The list shows
//   `ALMANAC_ROWS` (`10`) entries at a time, beginning at the entry at
//   `almanacScroll`", so the last window begins at entry `6`.
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `almanacScroll` after the frame,
// against the bound computed from the spec's own figures rather than written in
// as a number. Forty rows is far past the end of any tab, so a build that
// clamped nowhere runs off the list and a build that clamped to the wrong bound
// stops in the wrong place.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does: the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md); then
// one wheel event of forty rows of downward travel and the one frame that reads
// it. A frame's deltas are summed before the division, so the whole overshoot
// lands on that frame.
//
// THE TOLERANCE. None: a row index is a discrete figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  wheelBy,
  type Harness,
} from "../harness";

let h: Harness;

/** Far more travel than the list can take, so the bound is what answers. */
const ROWS = 40;

/** "`almanacScroll` is held within `0` and `max(0, count − ALMANAC_ROWS)`". */
const LAST_WINDOW = Math.max(0, ALMANAC_ENTRIES.TOOLS.length - ALMANAC_ROWS);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the almanac's first visible row at the last window under overshooting travel", async () => {
  const before = poseScene(h, "almanac");
  assertEqual(before.screen, "almanac", "the screen the wheel turns on");
  assertEqual(before.almanacTab, 0, "the tab the almanac is showing, TOOLS");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");

  const after = await wheelBy(h, ROWS);
  captureStill(h, "clamped");

  assertEqual(after.screen, "almanac", "the screen the wheel left the game on");
  assertEqual(
    after.almanacScroll,
    LAST_WINDOW,
    `the first visible row after ${ROWS} rows of downward travel, held at the TOOLS tab's ${ALMANAC_ENTRIES.TOOLS.length} entries less the ${ALMANAC_ROWS} the list shows`,
  );
});
