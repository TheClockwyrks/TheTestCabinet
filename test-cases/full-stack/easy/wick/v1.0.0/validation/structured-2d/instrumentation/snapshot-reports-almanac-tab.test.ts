// Wick — instrumentation/snapshot-reports-almanac-tab: on `almanac`,
// `almanacTab` reads the tab the screen is showing, and `0` on every other
// screen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// "Snapshot shape": "`almanacTab`: the tab the almanac is showing", and
// "`almanacTab` and `almanacScroll` sit beside `menuIndex`, outside `run`, and
// are `0` on every screen but `almanac`". What the field is reading is fixed by
// `specs/ui.md`, `almanac`: "`left` and `right` move `almanacTab` by one over
// `ALMANAC_TABS`, wrap at both ends". `almanacScroll` is
// `instrumentation/snapshot-reports-almanac-scroll`'s.
//
// WHAT IS READ, AND WHY. The field off the snapshot at three moments a build
// that stored nothing reads differently: on arriving, after a tab change, and
// off the screen again. A field that always read `0`, or one that never came
// back to `0` off the screen, fails here.
//
// THE DRIVE. `setScreen("almanac")`, then two `right` presses onto `ENEMIES`
// (`ALMANAC_TABS` index 2), then `title` and an isolated `playing` run.
//
// THE TOLERANCE. None: the field is a whole index the specification names
// exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  poseScreen,
  tap,
  type Harness,
} from "../harness";

/** The tab the drive selects: `ENEMIES`, the third of `ALMANAC_TABS`. */
const POSED_TAB = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the almanac's tab, and 0 off the screen", async () => {
  const opened = poseScreen(h, "almanac");
  assertEqual(opened.almanacTab, 0, "almanacTab on arriving at the almanac");

  for (let press = 0; press < POSED_TAB; press += 1) {
    await tap(h, "ArrowRight");
  }
  const turned = h.snapshot();
  await h.frameDraw();
  captureStill(h, "tab");
  assertEqual(
    turned.almanacTab,
    POSED_TAB,
    `almanacTab reads the tab shown, ${ALMANAC_TABS[POSED_TAB]}`,
  );

  const title = poseScreen(h, "title");
  assertEqual(title.almanacTab, 0, "almanacTab on title");

  const playing = isolate(h);
  assertEqual(playing.almanacTab, 0, "almanacTab on playing");
});
