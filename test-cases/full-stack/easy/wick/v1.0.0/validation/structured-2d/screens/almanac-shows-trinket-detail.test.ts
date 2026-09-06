// Wick — screens/almanac-shows-trinket-detail: the `TRINKETS` tab shows the
// highlighted passive's name, its one figure, and its line of copy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", shows
// the entry at `menuIndex` "in four parts": the Name, "The ... passive's from
// `PASSIVES`"; the Stats, "The lines the table below names, each the label
// written exactly as it appears there and its figure beside it"; and the
// Description, "The entry's line from the Descriptions section below, on one
// line". The tab table gives `TRINKETS` "`MAX LEVEL` and its max level in
// `PASSIVES`", and `specs/passives.md` gives Wick a max level of `5`. The
// Descriptions section gives `wick` its line character for character.
//
// WHAT IS READ. The strings the frame drew, and whether `MAX LEVEL` and its
// figure were drawn on ONE LINE — which is what "beside it" fixes. The name is
// read WHERE THE PANE IS: the specification puts the entry's four parts "to
// the right of the list", and the list draws the same name on its own row, so
// a name read anywhere on the frame is one the list answers for and the pane
// never has to. The pane's place, its palette, and the type it is set in are
// the build's (`specs/ui.md`, Presentation), so what is read is the name's
// place RELATIVE to the rows the list drew beside it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, and one
// `ArrowRight` onto the second tab, which "set[s] `menuIndex` and
// `almanacScroll` to `0`", so the entry shown is the first of `PASSIVE_IDS`,
// Wick.
//
// THE TOLERANCE. The name and the line of copy are exact, ignoring case and
// surrounding characters. The figure is matched as a whole figure, so `5` is
// read on a line writing `5 levels` and not on one writing `15`; the label is
// matched case-sensitively, because the specification writes it "exactly as it
// appears there". One line is `STAT_LINE` device pixels of slack between the
// two anchors, which the module states. The name's place carries no slack in
// the other direction: any anchor past the last of the list's rows is the
// pane's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_ENTRY_NAMES,
  ALMANAC_STAT_LABELS,
  ALMANAC_TABS,
  PASSIVES,
  PASSIVE_DESCRIPTIONS,
} from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScreen,
  placedRuns,
  type Harness,
} from "../harness";
import { drewRightOfList, moveTab, statLine, windowNames } from "./almanac";

/** The entry shown: the first of the trinkets tab, Wick. */
const ENTRY = "wick";
const AT = ALMANAC_TABS.indexOf("TRINKETS");

/** The rows the list draws beside Wick's, which place the list on the stage. */
const BESIDE = windowNames("TRINKETS", 0).filter(
  (row) => row !== PASSIVES[ENTRY].name,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws Wick's name, MAX LEVEL, and its description", async () => {
  assertEqual(
    ALMANAC_ENTRY_NAMES.TRINKETS[0],
    PASSIVES[ENTRY].name,
    "the first entry of the trinkets tab (specs/ui.md, almanac)",
  );

  h.reset();
  poseScreen(h, "almanac");
  const shown = await moveTab(h, AT);
  assertEqual(shown.almanacTab, AT, "the tab the almanac is showing");
  assertEqual(shown.menuIndex, 0, "the entry the detail pane shows");

  const { calls } = await h.frameDraw();
  captureStill(h, "trinket");

  const draws = placedRuns(calls);
  assertTrue(
    drewRightOfList(draws, PASSIVES[ENTRY].name, BESIDE),
    `the detail pane drew the entry's name, ${PASSIVES[ENTRY].name}, to the right of the list (specs/ui.md, almanac)`,
  );
  assertTrue(
    drewText(calls, PASSIVE_DESCRIPTIONS[ENTRY]),
    `the detail pane drew the entry's line from PASSIVE_DESCRIPTIONS (specs/ui.md, Descriptions)`,
  );
  assertTrue(
    statLine(
      draws,
      ALMANAC_STAT_LABELS.maxLevel,
      String(PASSIVES[ENTRY].maxLevel),
    ),
    `${ALMANAC_STAT_LABELS.maxLevel} written with ${PASSIVES[ENTRY].maxLevel} beside it, Wick's max level (specs/ui.md, almanac)`,
  );
});
