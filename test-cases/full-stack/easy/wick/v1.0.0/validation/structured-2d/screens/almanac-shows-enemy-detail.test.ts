// Wick — screens/almanac-shows-enemy-detail: the `ENEMIES` tab shows the
// highlighted enemy's name, its three figures, and its line of copy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", shows
// the entry at `menuIndex` "in four parts": the Name, "The ... enemy's from
// `ENEMIES`"; the Stats, "The lines the table below names, each the label
// written exactly as it appears there and its figure beside it"; and the
// Description, "The entry's line from the Descriptions section below, on one
// line". The tab table gives `ENEMIES` "`HEALTH`, `SPEED`, and `DAMAGE`, and
// the `hp`, `speed`, and `damage` of its row in `ENEMIES`", and
// `specs/enemies.md` gives the Moth `hp` `5`, `speed` `100`, and `damage` `5`.
// The Descriptions section gives `moth` its line character for character.
//
// WHAT IS READ. The strings the frame drew, and, for each of the three stats,
// whether the label and its figure were drawn on ONE LINE — which is what
// "beside it" fixes. The name is read WHERE THE PANE IS: the specification
// puts the entry's four parts "to the right of the list", and the list draws
// the same name on its own row, so a name read anywhere on the frame is one
// the list answers for and the pane never has to. The pane's place, its
// palette, and the type it is set in are the build's (`specs/ui.md`,
// Presentation), so what is read is the name's place RELATIVE to the rows the
// list drew beside it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, and two
// `ArrowRight` presses onto the third tab, which "set[s] `menuIndex` and
// `almanacScroll` to `0`", so the entry shown is the first of `ENEMY_IDS`, the
// Moth.
//
// THE TOLERANCE. The name and the line of copy are exact, ignoring case and
// surrounding characters. A figure is matched as a whole figure, so `5` is
// read on a line writing `5 hp` and not on one writing `50`; a label is
// matched case-sensitively, because the specification writes it "exactly as it
// appears there". One line is `STAT_LINE` device pixels of slack between the
// two anchors, which the module states — well under the pitch two legible
// lines of a pane can be stacked at, so the Moth's `HEALTH` and `DAMAGE`, both
// `5`, are decided on their own lines. The name's place carries no slack in
// the other direction: any anchor past the last of the list's rows is the
// pane's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_ENTRY_NAMES,
  ALMANAC_STAT_LABELS,
  ALMANAC_TABS,
  ENEMIES,
  ENEMY_DESCRIPTIONS,
  ENEMY_NAMES,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScreen,
  textDraws,
  type Harness,
} from "../harness";
import { drewRightOfList, moveTab, statLine, windowNames } from "./almanac";

/** The entry shown: the first of the enemies tab, the Moth, and its row. */
const ENTRY = "moth";
const ROW = ENEMIES[ENTRY];
const AT = ALMANAC_TABS.indexOf("ENEMIES");

/** The rows the list draws beside the Moth's, which place the list on the stage. */
const BESIDE = windowNames("ENEMIES", 0).filter(
  (row) => row !== ENEMY_NAMES[ENTRY],
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the Moth's name, HEALTH, SPEED, DAMAGE, and its description", async () => {
  assertEqual(
    ALMANAC_ENTRY_NAMES.ENEMIES[0],
    ENEMY_NAMES[ENTRY],
    "the first entry of the enemies tab (specs/ui.md, almanac)",
  );

  h.reset();
  poseScreen(h, "almanac");
  const shown = await moveTab(h, AT);
  assertEqual(shown.almanacTab, AT, "the tab the almanac is showing");
  assertEqual(shown.menuIndex, 0, "the entry the detail pane shows");

  const { calls } = await h.frameDraw();
  captureStill(h, "enemy");

  const draws = textDraws(calls);
  assertTrue(
    drewRightOfList(draws, ENEMY_NAMES[ENTRY], BESIDE),
    `the detail pane drew the entry's name, ${ENEMY_NAMES[ENTRY]}, to the right of the list (specs/ui.md, almanac)`,
  );
  assertTrue(
    drewText(calls, ENEMY_DESCRIPTIONS[ENTRY]),
    `the detail pane drew the entry's line from ENEMY_DESCRIPTIONS (specs/ui.md, Descriptions)`,
  );

  const lines: readonly [string, number][] = [
    [ALMANAC_STAT_LABELS.health, ROW.hp],
    [ALMANAC_STAT_LABELS.speed, ROW.speed],
    [ALMANAC_STAT_LABELS.damage, ROW.damage],
  ];
  for (const [label, figure] of lines) {
    assertTrue(
      statLine(draws, label, String(figure)),
      `${label} written with ${figure} beside it, the Moth's row in ENEMIES (specs/ui.md, almanac)`,
    );
  }
});
