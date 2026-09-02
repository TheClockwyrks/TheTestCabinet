// Wick — screens/almanac-scroll-clamped-at-top: the list returns to its top
// row when the highlight walks back to the first entry.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`almanacScroll` follows the highlight: after every move of `menuIndex` it
// becomes the lesser of `almanacScroll` and `menuIndex`". At `menuIndex` `0`
// the lesser of the two is `0`, and the clause that follows can only raise the
// scroll to `menuIndex − ALMANAC_ROWS + 1`, which is negative there, so the
// scroll is `0` whatever it had reached.
//
// WHAT IS READ. `menuIndex` and `almanacScroll` after the walk down and back.
// The scroll is read at the bottom of the walk as well, so a build whose list
// never scrolled fails on the arrangement rather than on the return.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, ten
// `ArrowDown` presses down the tools list and ten `ArrowUp` presses back.
//
// THE TOLERANCE. None: two indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { moveEntry } from "./almanac";

/** How far down the list the highlight walks before it walks back. */
const WALKED = ALMANAC_ROWS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 with almanacScroll 0 after walking down and back", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const down = await moveEntry(h, WALKED);
  assertEqual(down.menuIndex, WALKED, "menuIndex at the bottom of the walk");
  assertGreaterThan(
    down.almanacScroll,
    0,
    "almanacScroll at the bottom of the walk, the list scrolled off its first row",
  );

  const after = await moveEntry(h, -WALKED);
  captureStill(h, "top");

  assertEqual(after.screen, "almanac", "the screen after the walk back");
  assertEqual(after.menuIndex, 0, "menuIndex after the walk back");
  assertEqual(
    after.almanacScroll,
    0,
    "almanacScroll with the highlight back on the first entry (specs/ui.md, almanac)",
  );
});
