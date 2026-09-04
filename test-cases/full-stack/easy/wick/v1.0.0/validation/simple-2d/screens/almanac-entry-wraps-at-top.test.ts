// screens/almanac-entry-wraps-at-top — the entry highlight wraps past the first
// entry.
//
// WHAT THIS DECIDES. One thing: an `up` press with the first entry of the tab
// highlighted reaches the last, rather than stopping at the top of the list.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`): "`up` and `down` move `menuIndex` by one over the
//   tab's entries and wrap at both ends", "`menuIndex` ... is `0` on arriving",
//   and the `TOOLS` row of the entries table, "the ten of `BASE_WEAPON_IDS`,
//   then the six of `EVOLUTION_IDS`".
//   specs/controls.md ("What each screen reads"): on `almanac`, "`up`, `down`
//   move the entry highlight, wrapping".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which opens on the
// `TOOLS` tab with `menuIndex` `0`, then one `ArrowUp` over one frame. The
// entry it must reach is the last of the tab's entry list.
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
import { UP_KEY } from "./almanac";

let h: Harness;

/** The last entry of the tools tab: index fifteen of its sixteen entries. */
const LAST = ALMANAC_ENTRIES.TOOLS.length - 1;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reaches the last entry from the first on an up press", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen ArrowUp is pressed on");
  assertEqual(posed.almanacTab, 0, "the tab the list is walked on");
  assertEqual(posed.menuIndex, 0, "the entry the wrap is pressed from");

  const after = await tap(h, UP_KEY);
  captureStill(h, "wrap");

  assertEqual(after.screen, "almanac", "the screen the press left the game on");
  assertEqual(after.menuIndex, LAST, "the entry the wrap reached");
});
