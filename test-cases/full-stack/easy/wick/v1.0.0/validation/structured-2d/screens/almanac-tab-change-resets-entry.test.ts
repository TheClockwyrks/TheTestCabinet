// Wick — screens/almanac-tab-change-resets-entry: a tab change returns the
// list to its first entry and its first row.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at
// both ends, and set `menuIndex` and `almanacScroll` to `0`."
//
// WHAT IS READ. `menuIndex` and `almanacScroll` after the tab change, from a
// list that had been walked well past its first window. The `TOOLS` tab holds
// sixteen entries, "the ten of `BASE_WEAPON_IDS`, then the six of
// `EVOLUTION_IDS`", so an entry at index `12` is real and, under the scroll
// rule, cannot be shown from row `0`: `almanacScroll` is at least
// `menuIndex − ALMANAC_ROWS + 1` (`3`). Both are read before the press, so a
// build whose list never scrolled fails on the arrangement rather than on the
// reset.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, twelve
// `ArrowDown` presses down the tools list, then one `ArrowRight`.
//
// THE TOLERANCE. None: two indices.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";
import { moveEntry } from "./almanac";

/** How far down the tools list the highlight is walked before the tab change. */
const WALKED = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 and almanacScroll 0 after ArrowRight", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const walked = await moveEntry(h, WALKED);
  assertEqual(walked.menuIndex, WALKED, "menuIndex before the tab change");
  assertGreaterThan(
    walked.almanacScroll,
    0,
    "almanacScroll before the tab change, the list scrolled off its first row",
  );

  const after = await tap(h, "ArrowRight");
  captureStill(h, "reset");

  assertEqual(after.screen, "almanac", "the screen after the tab change");
  assertEqual(
    after.menuIndex,
    0,
    "menuIndex after a tab change (specs/ui.md, almanac)",
  );
  assertEqual(
    after.almanacScroll,
    0,
    "almanacScroll after a tab change (specs/ui.md, almanac)",
  );
});
