// screens/almanac-lists-trinkets — the TRINKETS tab lists every passive.
//
// WHAT THIS DECIDES. One thing: the trinkets tab's list holds the ten passive
// names in `PASSIVE_IDS` order, drawn one below the next. What the highlighted
// entry SHOWS is `almanac-shows-trinket-detail`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the entries table): "`TRINKETS` | the ten of
//   `PASSIVE_IDS`".
//   specs/ui.md (`almanac`): "the entries of that tab listed down the left",
//   "The list shows `ALMANAC_ROWS` (`10`) entries at a time ... and a tab of
//   `ALMANAC_ROWS` entries or fewer shows all of them", and "Each row shows its
//   entry's name."
//   specs/ui.md (`almanac`, the parts table): "Name | ... the passive's from
//   `PASSIVES`".
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then one `ArrowRight`
// to reach the trinkets tab through the screen's own key, and one frame. The
// tab holds exactly `ALMANAC_ROWS` entries, so one frame shows all of them and
// no walk of the list is needed.
//
// THE TOLERANCE. Each name is matched as a run of text holding it, so a build
// that marks the highlighted row or draws a shadow under its text passes; the
// order is read as a strict inequality between the topmost anchor of each
// name, which admits any pitch, font, alignment and place the build chose.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ENTRY_NAMES } from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { assertNamesDown, tabIndex, walkToTab } from "./almanac";

let h: Harness;

/** The ten names, in the order specs/ui.md's entries table gives them. */
const NAMES = ALMANAC_ENTRY_NAMES.TRINKETS;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lists the ten passive names down the frame, in order", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");

  const staged = await walkToTab(h, "TRINKETS");
  assertEqual(
    staged.almanacTab,
    tabIndex("TRINKETS"),
    "the tab the list is read on",
  );
  assertEqual(staged.almanacScroll, 0, "the list's first row on the new tab");

  const { calls } = await h.frameDraw();
  captureStill(h, "trinkets");

  assertNamesDown(calls, NAMES, "the trinkets tab's list");
});
