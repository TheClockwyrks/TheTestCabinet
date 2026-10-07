// screens/almanac-scroll-clamped-at-end — the list stops at its last window of
// rows when the highlight reaches the last entry.
//
// WHAT THIS DECIDES. One thing: with `menuIndex` on the final entry of a tab
// longer than the list, `almanacScroll` stands at `max(0, count − ALMANAC_ROWS)`
// rather than past it. The other end of the clamp is
// `almanac-scroll-clamped-at-top`'s, and the wheel's route to this same bound is
// `pointer/almanac-wheel-clamped`'s.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`almanacScroll` follows the highlight: after
//   every move of `menuIndex` it becomes the lesser of `almanacScroll` and
//   `menuIndex`, then the greater of that and `menuIndex − ALMANAC_ROWS + 1`,
//   and is then held between `0` and `max(0, count − ALMANAC_ROWS)`, for
//   `count` the number of entries the tab holds."
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries", with the `TOOLS` tab's sixteen entries.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then one `ArrowDown`
// press per entry short of the last, so the walk stops on the final entry
// without wrapping. The entry the walk reached is asserted first, so a build
// whose `down` is broken fails the point that owns it rather than this one.
//
// THE TOLERANCE. None: a first row is a whole index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRIES, ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { DOWN_KEY, tapTimes } from "./almanac";

/** How many entries the tab the almanac opens on lists. */
const COUNT = ALMANAC_ENTRIES.TOOLS.length;

/** "`almanacScroll` is held within `0` and `max(0, count − ALMANAC_ROWS)`". */
const LAST_WINDOW = Math.max(0, COUNT - ALMANAC_ROWS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds almanacScroll at the last window with the highlight on the last entry", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the list is walked on");

  const down = await tapTimes(h, DOWN_KEY, COUNT - 1);
  captureStill(h, "end");

  assertEqual(down.menuIndex, COUNT - 1, "the last entry the walk reached");
  assertEqual(
    down.almanacScroll,
    LAST_WINDOW,
    `the list's first visible row with the highlight on entry ${COUNT - 1}, the TOOLS tab's ${COUNT} entries less the ${ALMANAC_ROWS} the list shows`,
  );
});
