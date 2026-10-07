// Wick — screens/almanac-entry-wraps-at-bottom: `down` on the last entry
// reaches the first.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`": "`up`
// and `down` move `menuIndex` by one over the tab's entries and wrap at both
// ends." The tab is `TOOLS`, whose entries are "the ten of `BASE_WEAPON_IDS`,
// then the six of `EVOLUTION_IDS`", so its last entry is index `15`.
//
// WHAT IS READ. `menuIndex` after the press that leaves the end of the list.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it on the first tab with `menuIndex` `0`, fifteen `ArrowDown` presses
// onto the last entry, read there, then the sixteenth `ArrowDown`.
//
// THE TOLERANCE. None: an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRY_COUNTS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";
import { moveEntry } from "./almanac";

/** The last entry of the tools tab: its sixteen entries less one. */
const LAST = ALMANAC_ENTRY_COUNTS.TOOLS - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads menuIndex 0 after ArrowDown on the last tools entry", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const atEnd = await moveEntry(h, LAST);
  assertEqual(atEnd.menuIndex, LAST, "menuIndex before the wrapping press");

  const after = await tap(h, "ArrowDown");
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen after the wrapping press");
  assertEqual(
    after.menuIndex,
    0,
    `menuIndex after ArrowDown on entry ${LAST} (specs/ui.md, almanac)`,
  );
});
