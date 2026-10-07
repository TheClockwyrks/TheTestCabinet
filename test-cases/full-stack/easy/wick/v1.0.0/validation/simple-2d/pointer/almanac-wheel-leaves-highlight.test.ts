// pointer/almanac-wheel-leaves-highlight — the wheel moves the list and leaves
// the highlight where it is.
//
// WHAT THIS DECIDES. One thing: on the almanac's `TOOLS` tab with `menuIndex`
// `3`, one frame carrying `WHEEL_ROW` (`100`) stage units of downward wheel
// travel leaves `menuIndex` at `3`. What the same travel does to
// `almanacScroll` is its own point; here the moved list is only the evidence
// that the wheel was read at all.
//
// THE SPEC IT RESTS ON.
//   specs/controls.md (The pointer), rule 3: "`menuIndex` is untouched by the
//   wheel", the rule reading "A frame's travel is that frame's wheel deltas
//   summed in stage units, divided by `WHEEL_ROW` (`100`) and truncated toward
//   zero to give the number of rows `almanacScroll` moves".
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries and wrap at both ends", which is the only thing that moves
//   it, and "`menuIndex`, `almanacTab`, and `almanacScroll` are `0` on
//   arriving".
//
// WHAT IS READ, AND WHY IT DECIDES THE CLAIM. `menuIndex` after the frame the
// travel falls on, against the `3` it held before. `almanacScroll` is read
// alongside it as a precondition rather than as the claim: a build that ignored
// the wheel entirely would hold the highlight for the wrong reason, so the list
// must be seen to have moved for the reading about the highlight to mean
// anything.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which "Enters the
// almanac exactly as confirming `THE ALMANAC` does: the idle run, `menuIndex`
// `0`, `almanacTab` `0`, `almanacScroll` `0`" (specs/instrumentation.md); then
// three `down` presses, the only way the surface poses a highlight, which carry
// `menuIndex` to `3` while "The list shows `ALMANAC_ROWS` (`10`) entries at a
// time" keeps `almanacScroll` at `0`. Then one wheel event of `WHEEL_ROW` units
// of downward travel and the one frame that reads it.
//
// THE TOLERANCE. None: two indices are discrete figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { WHEEL_ROW } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  wheelBy,
  type Harness,
} from "../harness";
import { moveHighlightDown } from "./pointing";

let h: Harness;

/** Where the highlight rests before the wheel turns; inside the first window. */
const HIGHLIGHT = 3;

/** One row of travel: `WHEEL_ROW` stage units downward. */
const ROWS = 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the almanac highlight while the wheel moves the list", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the wheel turns on");
  assertEqual(posed.almanacTab, 0, "the tab the almanac is showing, TOOLS");

  const before = await moveHighlightDown(h, HIGHLIGHT);
  assertEqual(before.menuIndex, HIGHLIGHT, "the highlight before the wheel");
  assertEqual(before.almanacScroll, 0, "the list's first visible row");

  const after = await wheelBy(h, ROWS);
  captureStill(h, "held");

  assertEqual(
    after.almanacScroll,
    ROWS,
    `the first visible row after ${ROWS * WHEEL_ROW} stage units of travel, the evidence the wheel was read`,
  );
  assertEqual(
    after.menuIndex,
    HIGHLIGHT,
    "the highlight after the wheel turned, which specs/controls.md leaves untouched",
  );
});
