// Wick — screens/almanac-shows-tool-detail: the `TOOLS` tab shows the
// highlighted weapon's name, its two figures, and its line of copy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", shows
// the entry at `menuIndex` "in four parts": the Name, "The weapon's from
// `WEAPON_NAMES`"; the Stats, "The lines the table below names, each the label
// written exactly as it appears there and its figure beside it"; and the
// Description, "The entry's line from the Descriptions section below, on one
// line". The tab table gives `TOOLS` "`DAMAGE` and the `damage` of its level
// `1` row, and `COOLDOWN` and that row's `cooldown` in seconds", and
// `specs/weapons.md` gives Taper's level `1` row `damage` `10` and `cooldown`
// `1.35`. The Descriptions section gives `taper` its line character for
// character.
//
// WHAT IS READ. The strings the frame drew, and, for each stat, whether the
// label and its figure were drawn on ONE LINE — which is what "beside it"
// fixes. The name is read WHERE THE PANE IS: the specification puts the
// entry's four parts "to the right of the list", and the list draws the same
// name on its own row, so a name read anywhere on the frame is one the list
// answers for and the pane never has to. The pane's place, its palette, and
// the type it is set in are the build's (`specs/ui.md`, Presentation), so what
// is read is the name's place RELATIVE to the rows the list drew beside it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, which
// enters it on the first tab with "`menuIndex` `0`"
// (`specs/instrumentation.md`), so the entry shown is the first of
// `BASE_WEAPON_IDS`, Taper. Nothing is pressed.
//
// THE TOLERANCE. The name and the line of copy are exact, ignoring case and
// surrounding characters. A figure is matched as a whole figure, so a build
// that writes the cooldown as `1.35s` or the damage as `10 dmg` still reads as
// having drawn it while one that writes `100` does not; the label is matched
// case-sensitively, because the specification writes it "exactly as it appears
// there". One line is `STAT_LINE` device pixels of slack between the two
// anchors, which the module states. The name's place carries no slack in the
// other direction: any anchor past the last of the list's rows is the pane's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_ENTRY_NAMES,
  ALMANAC_STAT_LABELS,
  WEAPON_DESCRIPTIONS,
  WEAPON_LEVELS,
  WEAPON_NAMES,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScreen,
  textDraws,
  type Harness,
} from "../harness";
import { drewRightOfList, statLine, windowNames } from "./almanac";

/** The entry shown: the first of the tools tab, Taper, and its level 1 row. */
const ENTRY = "taper";
const ROW = WEAPON_LEVELS[ENTRY][0];

/** The rows the list draws beside Taper's, which place the list on the stage. */
const BESIDE = windowNames("TOOLS", 0).filter(
  (row) => row !== WEAPON_NAMES[ENTRY],
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws Taper's name, DAMAGE, COOLDOWN, and its description", async () => {
  assertEqual(
    ALMANAC_ENTRY_NAMES.TOOLS[0],
    WEAPON_NAMES[ENTRY],
    "the first entry of the tools tab (specs/ui.md, almanac)",
  );

  h.reset();
  const posed = poseScreen(h, "almanac");
  assertEqual(posed.almanacTab, 0, "the tab the almanac opens on");
  assertEqual(posed.menuIndex, 0, "the entry the detail pane shows");

  const { calls } = await h.frameDraw();
  captureStill(h, "tool");

  const draws = textDraws(calls);
  assertTrue(
    drewRightOfList(draws, WEAPON_NAMES[ENTRY], BESIDE),
    `the detail pane drew the entry's name, ${WEAPON_NAMES[ENTRY]}, to the right of the list (specs/ui.md, almanac)`,
  );
  assertTrue(
    drewText(calls, WEAPON_DESCRIPTIONS[ENTRY]),
    `the detail pane drew the entry's line from WEAPON_DESCRIPTIONS (specs/ui.md, Descriptions)`,
  );

  assertTrue(
    statLine(draws, ALMANAC_STAT_LABELS.damage, String(ROW.damage)),
    `${ALMANAC_STAT_LABELS.damage} written with ${ROW.damage} beside it, Taper's level 1 damage (specs/ui.md, almanac)`,
  );
  assertTrue(
    statLine(draws, ALMANAC_STAT_LABELS.cooldown, String(ROW.cooldown)),
    `${ALMANAC_STAT_LABELS.cooldown} written with ${ROW.cooldown} beside it, Taper's level 1 cooldown in seconds (specs/ui.md, almanac)`,
  );
});
