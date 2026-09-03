// screens/almanac-shows-trinket-detail — the TRINKETS tab describes its
// highlighted passive.
//
// WHAT THIS DECIDES. One thing: the frame of the trinkets tab with its first
// entry highlighted carries that passive's name, the one stat label the tab's
// row of the picture-and-stats table names with its max level beside it, and
// the passive's line of copy.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the parts table): "Name | ... the passive's from
//   `PASSIVES`", "Stats | The lines the table below names, each the label
//   written exactly as it appears there and its figure beside it", and
//   "Description | The entry's line from the Descriptions section below, on one
//   line."
//   specs/ui.md (`almanac`, the picture-and-stats table): "`TRINKETS` | the
//   passive's icon | `MAX LEVEL` and its max level in `PASSIVES`".
//   specs/passives.md: Wick's row of `PASSIVES`, whose max level is `5`.
//   specs/ui.md (Descriptions, `PASSIVE_DESCRIPTIONS`): Wick's line.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then one `ArrowRight`
// to reach the trinkets tab through the screen's own key, which sets
// `menuIndex` to `0`, and one frame. The entry read is the first of
// `PASSIVE_IDS`, so the list is never walked.
//
// THE TOLERANCE. The name, the label and the line are matched as words in
// order through `drewPhrase`, which admits any font, wrap, marker, or split
// across runs. The figure is matched as a number the frame wrote, within
// `FIGURE_TOLERANCE`, because specs/ui.md fixes the figure and its label but
// fixes no place for it and nothing about what a build writes beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_STAT_LABELS,
  PASSIVES,
  PASSIVE_DESCRIPTIONS,
  PASSIVE_IDS,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewPhrase,
  poseScene,
  type Harness,
} from "../harness";
import { drewFigure, tabIndex, walkToTab } from "./almanac";

let h: Harness;

/** The trinkets tab's first entry. */
const TRINKET = PASSIVE_IDS[0];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the passive's name, its MAX LEVEL, and its line", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");

  const staged = await walkToTab(h, "TRINKETS");
  assertEqual(
    staged.almanacTab,
    tabIndex("TRINKETS"),
    "the tab the entry is read on",
  );
  assertEqual(staged.menuIndex, 0, "the entry the detail is read for");

  const { calls } = await h.frameDraw();
  captureStill(h, "trinket");

  const copy = [
    PASSIVES[TRINKET].name,
    ALMANAC_STAT_LABELS.maxLevel,
    PASSIVE_DESCRIPTIONS[TRINKET],
  ];
  assertDeepEqual(
    copy.filter((text) => !drewPhrase(calls, text)),
    [],
    `the copy specs/ui.md gives ${PASSIVES[TRINKET].name}'s entry, missing from its frame`,
  );

  assertTrue(
    drewFigure(calls, PASSIVES[TRINKET].maxLevel),
    `the max level ${PASSIVES[TRINKET].maxLevel}, written on the entry's frame`,
  );
});
