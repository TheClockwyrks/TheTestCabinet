// Wick — screens/almanac-shows-pickup-detail: the `PICKUPS` tab shows the
// highlighted gem's name, its one figure, and its line of copy.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", shows
// the entry at `menuIndex` "in four parts": the Name, "The ... gem's or the
// pickup's from the names below", which gives `small` the name `Small Gem`;
// the Stats, "The lines the table below names, each the label written exactly
// as it appears there and its figure beside it"; and the Description, "The
// entry's line from the Descriptions section below, on one line". The tab
// table gives `PICKUPS` "a gem: `EXPERIENCE` and its tier's value in
// `GEM_VALUES`", and `specs/progression.md` gives the small gem the value `1`.
// The Descriptions section gives `small` its line character for character.
//
// WHAT IS READ. The strings the frame drew, and whether `EXPERIENCE` and its
// figure were drawn on ONE LINE — which is what "beside it" fixes. The name is
// read WHERE THE PANE IS: the specification puts the entry's four parts "to
// the right of the list", and the list draws the same name on its own row, so
// a name read anywhere on the frame is one the list answers for and the pane
// never has to. The pane's place, its palette, and the type it is set in are
// the build's (`specs/ui.md`, Presentation), so what is read is the name's
// place RELATIVE to the rows the list drew beside it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, and three
// `ArrowRight` presses onto the fourth tab, which "set[s] `menuIndex` and
// `almanacScroll` to `0`", so the entry shown is the first of `GEM_TIERS`, the
// small gem.
//
// THE TOLERANCE. The name and the line of copy are exact, ignoring case and
// surrounding characters. The figure is matched as a whole figure, so `1` is
// read on a line writing `1 xp` and not on one writing `12`; the label is
// matched case-sensitively, because the specification writes it "exactly as it
// appears there" — which also keeps the entry's own line of copy, which
// carries the word `experience` in lower case, out of the reading. One line is
// `STAT_LINE` device pixels of slack between the two anchors. The name's place
// carries no slack in the other direction: any anchor past the last of the
// list's rows is the pane's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  ALMANAC_ENTRY_NAMES,
  ALMANAC_STAT_LABELS,
  ALMANAC_TABS,
  GEM_DESCRIPTIONS,
  GEM_NAMES,
  GEM_VALUES,
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

/** The entry shown: the first of the pickups tab, the small gem. */
const ENTRY = "small";
const AT = ALMANAC_TABS.indexOf("PICKUPS");

/** The rows the list draws beside the small gem's, which place the list. */
const BESIDE = windowNames("PICKUPS", 0).filter(
  (row) => row !== GEM_NAMES[ENTRY],
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws Small Gem's name, EXPERIENCE, and its description", async () => {
  assertEqual(
    ALMANAC_ENTRY_NAMES.PICKUPS[0],
    GEM_NAMES[ENTRY],
    "the first entry of the pickups tab (specs/ui.md, almanac)",
  );

  h.reset();
  poseScreen(h, "almanac");
  const shown = await moveTab(h, AT);
  assertEqual(shown.almanacTab, AT, "the tab the almanac is showing");
  assertEqual(shown.menuIndex, 0, "the entry the detail pane shows");

  const { calls } = await h.frameDraw();
  captureStill(h, "pickup");

  const draws = placedRuns(calls);
  assertTrue(
    drewRightOfList(draws, GEM_NAMES[ENTRY], BESIDE),
    `the detail pane drew the entry's name, ${GEM_NAMES[ENTRY]}, to the right of the list (specs/ui.md, almanac)`,
  );
  assertTrue(
    drewText(calls, GEM_DESCRIPTIONS[ENTRY]),
    `the detail pane drew the entry's line from GEM_DESCRIPTIONS (specs/ui.md, Descriptions)`,
  );
  assertTrue(
    statLine(draws, ALMANAC_STAT_LABELS.experience, String(GEM_VALUES[ENTRY])),
    `${ALMANAC_STAT_LABELS.experience} written with ${GEM_VALUES[ENTRY]} beside it, the small gem's value in GEM_VALUES (specs/ui.md, almanac)`,
  );
});
