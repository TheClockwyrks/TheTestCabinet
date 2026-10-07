// Wick — screens/almanac-tab-wraps-at-end: `right` on the last tab reaches the
// first.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`":
// "`left` and `right` move `almanacTab` by one over `ALMANAC_TABS`, wrap at
// both ends". `ALMANAC_TABS` holds four names, so the last tab is index `3`
// and the tab past it is `0`.
//
// WHAT IS READ. `almanacTab` after the press that leaves the end of the bar.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, three
// `ArrowRight` presses onto the last tab, read there, then the fourth
// `ArrowRight`.
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
import { moveTab } from "./almanac";

/** The last tab of the bar. */
const LAST = ALMANAC_TABS.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads almanacTab 0 after ArrowRight on the last tab", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const atEnd = await moveTab(h, LAST);
  assertEqual(atEnd.almanacTab, LAST, "almanacTab before the wrapping press");

  const after = await tap(h, "ArrowRight");
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen after the wrapping press");
  assertEqual(
    after.almanacTab,
    0,
    `almanacTab after ArrowRight on tab ${LAST} (specs/ui.md, almanac)`,
  );
});
