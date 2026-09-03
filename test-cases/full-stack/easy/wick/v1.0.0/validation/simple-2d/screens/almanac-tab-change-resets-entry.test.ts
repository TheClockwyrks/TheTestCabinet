// screens/almanac-tab-change-resets-entry — a tab change returns the list to
// its first entry.
//
// WHAT THIS DECIDES. One thing: a tab change sets `menuIndex` and
// `almanacScroll` back to `0`, so the new tab's list opens at its top however
// far the old tab's list had been walked. That the tab itself moved is
// `almanac-right-moves-tab`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`left` and `right` move `almanacTab` by one over
//   `ALMANAC_TABS`, wrap at both ends, and set `menuIndex` and `almanacScroll`
//   to `0`."
//   specs/ui.md (`almanac`): "The list shows `ALMANAC_ROWS` (`10`) entries at a
//   time, beginning at the entry at `almanacScroll`", with the `TOOLS` tab's
//   sixteen entries.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then `ArrowDown`
// pressed until `menuIndex` is well past the window the list shows, which
// leaves both figures away from `0`; that is asserted as the precondition it
// is, so a build whose list never moved fails its own points rather than
// passing this one for having nothing to reset. Then the single `ArrowRight`
// this point is about.
//
// THE TOLERANCE. None: a menu index and a first row are exact figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ALMANAC_ROWS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { DOWN_KEY, RIGHT_KEY, tapTimes } from "./almanac";

let h: Harness;

/** An entry well inside the tools tab and well past the window: twelve. */
const WALKED = ALMANAC_ROWS + 2;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("sets menuIndex and almanacScroll to 0 on a tab change", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");

  const staged = await tapTimes(h, DOWN_KEY, WALKED);
  assertEqual(staged.menuIndex, WALKED, "the entry the tab change is made at");
  assertGreaterThan(
    staged.almanacScroll,
    0,
    "the list's first row before the tab change",
  );

  const after = await tap(h, RIGHT_KEY);
  captureStill(h, "reset");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.menuIndex, 0, "the entry the new tab opened on");
  assertEqual(after.almanacScroll, 0, "the new tab's first visible row");
});
