// screens/almanac-shows-enemy-detail — the ENEMIES tab describes its
// highlighted enemy.
//
// WHAT THIS DECIDES. One thing: the frame of the enemies tab with its first
// entry highlighted carries that enemy's name, the three stat labels the tab's
// row of the picture-and-stats table names with the figures of its row in
// `ENEMIES` beside them, and the enemy's line of copy. That its picture MOVES
// is `almanac-draws-enemy-animation`'s point.
//
// THE SPEC IT RESTS ON.
//   specs/ui.md (`almanac`, the parts table): "Name | ... the enemy's from
//   `ENEMIES`", "Stats | The lines the table below names, each the label
//   written exactly as it appears there and its figure beside it", and
//   "Description | The entry's line from the Descriptions section below, on one
//   line."
//   specs/ui.md (`almanac`, the picture-and-stats table): "`ENEMIES` | ... |
//   `HEALTH`, `SPEED`, and `DAMAGE`, and the `hp`, `speed`, and `damage` of its
//   row in `ENEMIES`".
//   specs/enemies.md: the Moth's row, `hp` `5`, `speed` `100`, `damage` `5`.
//   specs/ui.md (Descriptions, `ENEMY_DESCRIPTIONS`): the Moth's line.
//
// THE DRIVE. The almanac through `setScreen("almanac")`, then two `ArrowRight`
// presses to reach the enemies tab through the screen's own key, which sets
// `menuIndex` to `0`, and one frame. The entry read is the first of
// `ENEMY_IDS`, so the list is never walked.
//
// WHY EACH FIGURE IS READ BESIDE ITS LABEL. specs/ui.md fixes which label a
// figure belongs to, "each the label written exactly as it appears there and
// its figure beside it", and the Moth carries `5` for both `hp` and `damage`,
// so a figure read off the whole frame would let the health answer for the
// damage and leave the third reading unable to fail on its own. Each figure is
// therefore looked for on the line its own label was written on.
//
// THE TOLERANCE. The name, the labels and the line are matched as substrings
// of the frame's text through the shared harness's `drewTextAnywhere`,
// ignoring case and whitespace across every run the frame drew, which admits
// any font, wrap, marker, or split across runs. Each figure is matched as a number, within `FIGURE_TOLERANCE`,
// because specs/ui.md fixes the figure and its label but fixes no place for
// either and no unit beside the figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_STAT_LABELS,
  ENEMIES,
  ENEMY_DESCRIPTIONS,
  ENEMY_IDS,
} from "../constants";
import {
  captureStill,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { drewTextAnywhere } from "../case-harness/text";
import { drewFigureBeside, tabIndex, walkToTab } from "./almanac";

let h: Harness;

/** The enemies tab's first entry, and the row its three figures come from. */
const ENEMY = ENEMY_IDS[0];
const ROW = ENEMIES[ENEMY];

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the enemy's name, its three stat labels, and its line", async () => {
  const posed = poseScene(h, "almanac");
  assertEqual(posed.screen, "almanac", "the screen the frame is read from");

  const staged = await walkToTab(h, "ENEMIES");
  assertEqual(
    staged.almanacTab,
    tabIndex("ENEMIES"),
    "the tab the entry is read on",
  );
  assertEqual(staged.menuIndex, 0, "the entry the detail is read for");

  const { calls } = await h.frameDraw();
  captureStill(h, "enemy");

  const copy = [
    ROW.name,
    ALMANAC_STAT_LABELS.health,
    ALMANAC_STAT_LABELS.speed,
    ALMANAC_STAT_LABELS.damage,
    ENEMY_DESCRIPTIONS[ENEMY],
  ];
  assertDeepEqual(
    copy.filter((text) => !drewTextAnywhere(calls, text)),
    [],
    `the copy specs/ui.md gives ${ROW.name}'s entry, missing from its frame`,
  );

  const figures: readonly (readonly [string, number])[] = [
    [ALMANAC_STAT_LABELS.health, ROW.hp],
    [ALMANAC_STAT_LABELS.speed, ROW.speed],
    [ALMANAC_STAT_LABELS.damage, ROW.damage],
  ];
  for (const [label, figure] of figures) {
    assertTrue(
      drewFigureBeside(calls, label, figure),
      `the ${figure} of ${ROW.name}'s row, written beside ${label}`,
    );
  }
});
