// screens/almanac-shows-pickup-detail — the PICKUPS tab describes its
// highlighted entry.
//
// WHAT THIS DECIDES. One thing: the frame of the pickups tab with its first
// entry highlighted carries that gem's name, the `EXPERIENCE` label with the
// tier's value in `GEM_VALUES` beside it, and the gem's line of copy.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the parts table): "Name | ... the gem's or the
//   pickup's from the names below", "Stats | The lines the table below names,
//   each the label written exactly as it appears there and its figure beside
//   it", and "Description | The entry's line from the Descriptions section
//   below, on one line."
//   specs/ui.md (`almanac`, the picture-and-stats table): "`PICKUPS` | ... | a
//   gem: `EXPERIENCE` and its tier's value in `GEM_VALUES`".
//   specs/ui.md (`almanac`, the names table): "`GEM_NAMES` | `small` | `Small
//   Gem`".
//   specs/world.md (Gems): `GEM_VALUES` `small` `1`.
//   specs/ui.md (Descriptions, `GEM_DESCRIPTIONS`): the small gem's line.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then three
// `ArrowRight` presses to reach the pickups tab through the screen's own key,
// which sets `menuIndex` to `0`, and one frame. The entry read is the first of
// `GEM_TIERS`, so the list is never walked.
//
// THE TOLERANCE. The name, the label and the line are matched as substrings
// of the frame's text through the shared harness's `drewTextAnywhere`,
// ignoring case and whitespace across every run the frame drew, which admits
// any font, wrap, marker, or split across runs. The figure is matched as a number the frame wrote, within
// `FIGURE_TOLERANCE`, because specs/ui.md fixes the figure and its label but
// fixes no place for it and nothing about what a build writes beside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_STAT_LABELS,
  GEM_DESCRIPTIONS,
  GEM_NAMES,
  GEM_TIERS,
  GEM_VALUES,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { drewTextAnywhere } from "../case-harness/text";
import { drewFigure, tabIndex, walkToTab } from "./almanac";

let h: Harness;

/** The pickups tab's first entry: the first of `GEM_TIERS`. */
const TIER = GEM_TIERS[0];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the gem's name, its EXPERIENCE, and its line", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");

  const staged = await walkToTab(h, "PICKUPS");
  assertEqual(
    staged.almanacTab,
    tabIndex("PICKUPS"),
    "the tab the entry is read on",
  );
  assertEqual(staged.menuIndex, 0, "the entry the detail is read for");

  const { calls } = await h.frameDraw();
  captureStill(h, "pickup");

  const copy = [
    GEM_NAMES[TIER],
    ALMANAC_STAT_LABELS.experience,
    GEM_DESCRIPTIONS[TIER],
  ];
  assertDeepEqual(
    copy.filter((text) => !drewTextAnywhere(calls, text)),
    [],
    `the copy specs/ui.md gives ${GEM_NAMES[TIER]}'s entry, missing from its frame`,
  );

  assertTrue(
    drewFigure(calls, GEM_VALUES[TIER]),
    `the experience ${GEM_VALUES[TIER]} of ${GEM_NAMES[TIER]}, written on the entry's frame`,
  );
});
