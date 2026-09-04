// Wick — screens/almanac-tab-wraps-at-start: `left` on the first tab reaches
// the last.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at
// both ends". `ALMANAC_TABS` holds four names, so the tab before the first is
// index `3`.
//
// WHAT IS READ. `almanacTab` after the press that leaves the start of the bar.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it with "`almanacTab` `0`" (`specs/instrumentation.md`), then one
// real `ArrowLeft`.
//
// THE TOLERANCE. None: an index.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The last tab of the bar. */
const LAST = ALMANAC_TABS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the last almanacTab after ArrowLeft on tab 0", async () => {
  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.almanacTab, 0, "almanacTab before the wrapping press");

  const after = await tap(h, "ArrowLeft");
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen after the wrapping press");
  assertEqual(
    after.almanacTab,
    LAST,
    `almanacTab after ArrowLeft on tab 0, the last of the ${ALMANAC_TABS.length} ALMANAC_TABS (specs/ui.md, almanac)`,
  );
});
