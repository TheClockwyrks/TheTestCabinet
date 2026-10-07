// screens/almanac-scroll-follows-highlight — moving the highlight past the last
// visible row carries the window down with it.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "`almanacScroll`
// follows the highlight: after every move of `menuIndex` it becomes the lesser
// of `almanacScroll` and `menuIndex`, then the greater of that and
// `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`, for `count` the number of entries the tab
// holds." With `ALMANAC_ROWS` (`10`), a highlight at `9` leaves the window at
// `min(0, 9)` then `max(0, 0)`, which is `0`; the next move puts it at
// `max(min(0, 10), 10 − 10 + 1)`, which is `1`. The tab holds sixteen entries —
// "`TOOLS` | the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`" — so
// the ceiling `max(0, 16 − 10)` is `6` and does not bind here.
//
// WHY THE WORLD IS POSED AS IT IS. The surface carries no pose for `menuIndex`
// or `almanacScroll`, so the tenth entry is reached the only way it can be: one
// `ArrowDown` per entry from the `0` the almanac is entered on. Both fields are
// read back before the press that moves the window, so a build whose `down` is
// broken fails the point that owns it rather than this one. Every press is a
// REAL key through Chromium's input pipeline, held across exactly one frame.
//
// THE TOLERANCE. None: two indices are exact comparisons.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  pressDown,
  type Harness,
} from "../harness";
import { openAlmanac, poseEntry } from "./almanac";

/** The last entry the first window shows, `ALMANAC_ROWS − 1`. */
const LAST_VISIBLE = 9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads menuIndex 10 with almanacScroll 1 after ArrowDown on the tenth entry", async () => {
  await openAlmanac(h);
  const posed = await poseEntry(h, LAST_VISIBLE);
  assertEqual(posed.menuIndex, LAST_VISIBLE, "the entry the press is made on");
  assertEqual(
    posed.almanacScroll,
    0,
    "the window on the tenth entry, still at the top of the list",
  );

  const after = await pressDown(h);
  await captureStill(h, "scrolled");

  assertEqual(after.screen, "almanac", "the screen after ArrowDown");
  assertEqual(
    after.menuIndex,
    LAST_VISIBLE + 1,
    "menuIndex after ArrowDown past the last visible row",
  );
  assertEqual(
    after.almanacScroll,
    1,
    "almanacScroll after the highlight passed the last visible row " +
      "(specs/ui.md)",
  );
});
