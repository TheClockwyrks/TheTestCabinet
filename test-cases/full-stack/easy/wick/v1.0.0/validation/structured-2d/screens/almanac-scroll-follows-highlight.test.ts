// Wick — screens/almanac-scroll-follows-highlight: the list scrolls by one row
// when the highlight moves past its last visible row.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`almanacScroll` follows the highlight: after every move of `menuIndex` it
// becomes the lesser of `almanacScroll` and `menuIndex`, then the greater of
// that and `menuIndex − ALMANAC_ROWS + 1`, and is then held between `0` and
// `max(0, count − ALMANAC_ROWS)`." With `almanacScroll` `0` and `menuIndex`
// `10`, the second clause gives `10 − 10 + 1` (`1`), and the tools tab's
// sixteen entries put the ceiling at `6`, so the answer is exactly `1`.
//
// WHAT IS READ. `menuIndex` and `almanacScroll` after the press that carries
// the highlight off the last of the `ALMANAC_ROWS` (`10`) rows the list shows.
// Both are read at entry `9` first, where the rule leaves the scroll at `0`,
// so what this point decides is the step past the window.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, nine
// `ArrowDown` presses onto entry `9`, then the tenth.
//
// THE TOLERANCE. None: two indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";
import { moveEntry } from "./almanac";

/** The last row the list shows from `almanacScroll` `0`. */
const LAST_VISIBLE = ALMANAC_ROWS - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 10 with almanacScroll 1 after the step past row 9", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const atEdge = await moveEntry(h, LAST_VISIBLE);
  assertEqual(atEdge.menuIndex, LAST_VISIBLE, "menuIndex before the press");
  assertEqual(
    atEdge.almanacScroll,
    0,
    "almanacScroll on the last row the list shows",
  );

  const after = await tap(h, "ArrowDown");
  captureStill(h, "scrolled");

  assertEqual(after.screen, "almanac", "the screen after the press");
  assertEqual(after.menuIndex, ALMANAC_ROWS, "menuIndex after the press");
  assertEqual(
    after.almanacScroll,
    1,
    "almanacScroll after the highlight moved past the window (specs/ui.md, almanac)",
  );
});
