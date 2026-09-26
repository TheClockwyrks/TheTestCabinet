// screens/almanac-scroll-follows-highlight — the list scrolls to hold the
// highlight.
//
// WHAT THIS DECIDES. One thing: the move that takes `menuIndex` past the last
// row the window shows raises `almanacScroll` by one, so the highlight stays
// inside the `ALMANAC_ROWS` rows the list draws. The return to the top of the
// list is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`almanacScroll` follows the highlight: after
//   every move of `menuIndex` it becomes the lesser of `almanacScroll` and
//   `menuIndex`, then the greater of that and `menuIndex − ALMANAC_ROWS + 1`,
//   and is then held between `0` and `max(0, count − ALMANAC_ROWS)`, for
//   `count` the number of entries the tab holds."
//   specs/ui.md (`almanac`): "The list shows `ALMANAC_ROWS` (`10`) entries at a
//   time, beginning at the entry at `almanacScroll`", and "`almanacScroll` ...
//   is `0` on arriving".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which opens on the
// `TOOLS` tab with its sixteen entries, then `ArrowDown` pressed once for each
// row of the window past the first, which walks `menuIndex` onto the last
// visible row with `almanacScroll` still `0`; that state is asserted as the
// precondition it is, and then the one further `ArrowDown` this point is about
// is pressed. Both figures come from `ALMANAC_ROWS`, not from a written-in
// index.
//
// THE TOLERANCE. None: a menu index and a first row are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { DOWN_KEY, tapTimes } from "./almanac";

let h: Harness;

/** The last row the window shows from the top of the list: index nine of ten. */
const LAST_VISIBLE = ALMANAC_ROWS - 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("raises almanacScroll by one when the highlight leaves the window", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the list is walked on");

  const staged = await tapTimes(h, DOWN_KEY, LAST_VISIBLE);
  assertEqual(
    staged.menuIndex,
    LAST_VISIBLE,
    "the entry the last move is pressed from",
  );
  assertEqual(staged.almanacScroll, 0, "the list's first row before the move");

  const after = await tap(h, DOWN_KEY);
  captureStill(h, "scrolled");

  assertEqual(after.menuIndex, ALMANAC_ROWS, "the entry the move highlighted");
  assertEqual(after.almanacScroll, 1, "the list's first row after the move");
});
