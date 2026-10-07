// screens/almanac-entry-wraps-at-bottom — the entry highlight wraps past the
// last entry.
//
// WHAT THIS DECIDES. One thing: a `down` press with the last entry of the tab
// highlighted reaches the first, rather than stopping at the end of the list.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries and wrap at both ends", with the `TOOLS` row of the entries
//   table, "the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`up`, `down`
//   move the entry highlight, wrapping".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which opens on the
// `TOOLS` tab, then `ArrowDown` pressed once for each entry past the first,
// which walks `menuIndex` to the last entry through the screen's own key; the
// count is the length of the tab's entry list rather than a written-in index.
// The last entry is asserted before the press this point is about.
//
// THE TOLERANCE. None: a menu index is an exact figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRIES } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  tap,
  type Harness,
} from "../harness";
import { DOWN_KEY, tapTimes } from "./almanac";

let h: Harness;

/** The last entry of the tools tab: index fifteen of its sixteen entries. */
const LAST = ALMANAC_ENTRIES.TOOLS.length - 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches the first entry from the last on a down press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the keys are pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the list is walked on");

  const staged = await tapTimes(h, DOWN_KEY, LAST);
  assertEqual(staged.menuIndex, LAST, "the entry the wrap is pressed from");

  const after = await tap(h, DOWN_KEY);
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.menuIndex, 0, "the entry the wrap reached");
});
