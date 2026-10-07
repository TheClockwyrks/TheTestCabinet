// screens/almanac-shows-tool-detail — the TOOLS tab describes its highlighted
// weapon.
//
// WHAT THIS DECIDES. One thing: the frame of the tools tab with its first entry
// highlighted carries that weapon's name, the two stat labels the tab's row of
// the picture-and-stats table names with the figures of the weapon's level `1`
// row beside them, and the weapon's line of copy. The PICTURE beside them is
// `almanac-draws-tool-picture`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the parts table): "Name | The weapon's from
//   `WEAPON_NAMES`", "Stats | The lines the table below names, each the label
//   written exactly as it appears there and its figure beside it", and
//   "Description | The entry's line from the Descriptions section below, on one
//   line."
//   specs/ui.md (`almanac`, the picture-and-stats table): "`TOOLS` | ... |
//   `DAMAGE` and the `damage` of its level `1` row, and `COOLDOWN` and that
//   row's `cooldown` in seconds".
//   specs/weapons.md (Taper): the level `1` row, `damage` `10` and `cooldown`
//   `1.35`, which `constants.ts` carries as `TAPER_LEVELS[0]`.
//   specs/ui.md (Descriptions, `WEAPON_DESCRIPTIONS`): Taper's line.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, which opens on the
// tools tab with `menuIndex` `0`, and one frame. The entry read is the first of
// `BASE_WEAPON_IDS`, so no key is pressed and a build with a broken list still
// reaches the entry this point is about.
//
// THE TOLERANCE. The name, the labels and the line are matched as substrings
// of the frame's text through the shared harness's `drewTextAnywhere`,
// ignoring case and whitespace across every run the frame drew, which admits
// any font, wrap, marker, or split across runs. Each figure is matched as a number the frame wrote, within
// `FIGURE_TOLERANCE`, because specs/ui.md fixes the figure and its label but
// fixes no place for it and no unit beside it: a build writing `1.35`,
// `1.35 s`, or `1.35s` passes and a build writing another figure fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_STAT_LABELS,
  BASE_WEAPON_IDS,
  TAPER_LEVELS,
  WEAPON_DESCRIPTIONS,
  WEAPON_NAMES,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { drewTextAnywhere } from "../case-harness/text";
import { drewFigure } from "./almanac";

let h: Harness;

/** The tools tab's first entry, and the level 1 row its figures come from. */
const TOOL = BASE_WEAPON_IDS[0];
const ROW = TAPER_LEVELS[0];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the weapon's name, its two stat labels, and its line", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");
  assertEqual(posed.almanacTab, 0, "the tab the entry is read on");
  assertEqual(posed.menuIndex, 0, "the entry the detail is read for");

  const { calls } = await h.frameDraw();
  captureStill(h, "tool");

  const copy = [
    WEAPON_NAMES[TOOL],
    ALMANAC_STAT_LABELS.damage,
    ALMANAC_STAT_LABELS.cooldown,
    WEAPON_DESCRIPTIONS[TOOL],
  ];
  assertDeepEqual(
    copy.filter((text) => !drewTextAnywhere(calls, text)),
    [],
    `the copy specs/ui.md gives ${WEAPON_NAMES[TOOL]}'s entry, missing from its frame`,
  );

  assertTrue(
    drewFigure(calls, ROW.damage),
    `the damage ${ROW.damage} of the level 1 row, written on the entry's frame`,
  );
  assertTrue(
    drewFigure(calls, ROW.cooldown),
    `the cooldown ${ROW.cooldown} of the level 1 row, written on the entry's frame`,
  );
});
