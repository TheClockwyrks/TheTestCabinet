// screens/almanac-scroll-clamped-at-top — the list returns to its top with the
// highlight.
//
// WHAT THIS DECIDES. One thing: a walk down the list and back up it again
// leaves `almanacScroll` at `0` with `menuIndex` `0`, so the window follows the
// highlight back to the top rather than staying where it was pushed to. That
// the window follows the highlight DOWN is its own point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`almanacScroll` follows the highlight: after
//   every move of `menuIndex` it becomes the lesser of `almanacScroll` and
//   `menuIndex`, then the greater of that and `menuIndex − ALMANAC_ROWS + 1`,
//   and is then held between `0` and `max(0, count − ALMANAC_ROWS)`."
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries", with the `TOOLS` tab's sixteen entries.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then `ALMANAC_ROWS`
// `ArrowDown` presses, which is one more than the window holds and so leaves
// the list scrolled, and then the same number of `ArrowUp` presses. The
// scrolled state is asserted between the two walks, so a build that never
// scrolled at all fails there rather than passing this point by never having
// moved. Neither walk wraps: `ALMANAC_ROWS` (10) is below the sixteen entries
// the tools tab holds.
//
// THE TOLERANCE. None: a menu index and a first row are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { DOWN_KEY, UP_KEY, tapTimes } from "./almanac";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("returns almanacScroll to 0 when the highlight walks back to the top", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the list is walked on");

  const down = await tapTimes(h, DOWN_KEY, ALMANAC_ROWS);
  assertEqual(
    down.menuIndex,
    ALMANAC_ROWS,
    "the entry the walk down highlighted",
  );
  assertGreaterThan(
    down.almanacScroll,
    0,
    "the list's first row after the walk down",
  );

  const after = await tapTimes(h, UP_KEY, ALMANAC_ROWS);
  captureStill(h, "top");

  assertEqual(after.menuIndex, 0, "the entry the walk back up highlighted");
  assertEqual(after.almanacScroll, 0, "the list's first row at the top");
});
