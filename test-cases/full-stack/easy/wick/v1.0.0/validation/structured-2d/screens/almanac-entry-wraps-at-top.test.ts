// Wick — screens/almanac-entry-wraps-at-top: `up` on the first entry reaches
// the last.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`": "`up`
// and `down` move `menuIndex` by one over the tab's entries and wrap at both
// ends." The tab is `TOOLS`, whose entries are "the ten of `BASE_WEAPON_IDS`,
// then the six of `EVOLUTION_IDS`", so the entry before its first is index
// `15`.
//
// WHAT IS READ. `menuIndex` after the press that leaves the start of the list.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it on the first tab with "`menuIndex` `0`"
// (`specs/instrumentation.md`), then one real `ArrowUp`.
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

/** The last entry of the tools tab: its sixteen entries less one. */
const LAST = ALMANAC_ENTRY_COUNTS.TOOLS - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the last tools entry after ArrowUp on entry 0", async () => {
  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.menuIndex, 0, "menuIndex before the wrapping press");
  assertEqual(posed.almanacTab, 0, "the tab the press is made on");

  const after = await tap(h, "ArrowUp");
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen after the wrapping press");
  assertEqual(
    after.menuIndex,
    LAST,
    `menuIndex after ArrowUp on entry 0 of the tools tab's ${ALMANAC_ENTRY_COUNTS.TOOLS} entries (specs/ui.md, almanac)`,
  );
});
