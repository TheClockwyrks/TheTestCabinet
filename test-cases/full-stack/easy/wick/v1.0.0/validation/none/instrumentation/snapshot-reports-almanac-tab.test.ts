// Wick — instrumentation/snapshot-reports-almanac-tab: on `almanac`,
// `almanacTab` reads the tab the screen is showing.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape"):
// "`almanacTab`: the tab the almanac is showing", and "`almanacTab` and
// `almanacScroll` sit beside `menuIndex`, outside `run`". specs/state.md names
// the same field: "`almanacTab`: the index into `ALMANAC_TABS` of the tab the
// almanac is showing." What the field must read comes from specs/ui.md's own
// navigation: "`left` and `right` move `almanacTab` by one over
// `ALMANAC_TABS`". `almanacScroll` is
// `instrumentation/snapshot-reports-almanac-scroll`'s.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through its own
// `setScreen`, the field is read at its opening `0`, and then again after two
// real tab changes, so a build that reported a constant fails. Every reading is
// exact: an index is a whole number, not a measurement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseScreen,
  pressAction,
  type Harness,
} from "../harness";

/** The tab the check moves to: `ENEMIES`, the third of `ALMANAC_TABS`. */
const TAB = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the tab the almanac is showing", async () => {
  const opened = await poseScreen(h, "almanac");
  assertEqual(typeof opened.almanacTab, "number", "snapshot().almanacTab");
  assertEqual(opened.almanacTab, 0, "almanacTab on entering the almanac");

  for (let move = 0; move < TAB; move += 1) await pressAction(h, "right");
  const changed = await h.snapshot();
  await captureStill(h, "tab");

  assertEqual(changed.almanacTab, TAB, "almanacTab after two tab changes");
});
