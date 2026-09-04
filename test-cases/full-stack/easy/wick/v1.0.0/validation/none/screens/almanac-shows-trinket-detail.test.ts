// screens/almanac-shows-trinket-detail — the highlighted trinket is shown in
// full: its name, its figure, and its line of copy.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "The entry at
// `menuIndex` is shown in four parts", of which three are read here — "Name |
// The ... passive's from `PASSIVES`", "Stats | The lines the table below names,
// each the label written exactly as it appears there and its figure beside it",
// and "Description | The entry's line from the Descriptions section below, on
// one line" — and the tab's row of that table: "`TRINKETS` | the passive's icon
// | `MAX LEVEL` and its max level in `PASSIVES`". Wick's row in
// specs/passives.md is "| Wick | `wick` | `5` | `+10%` weapon damage |", so the
// figure is `5`, and Wick's line is the `wick` entry of `PASSIVE_DESCRIPTIONS`.
// The fourth part, the icon, is the presentation category's.
//
// WHY THE WORLD IS POSED AS IT IS. The tab is walked to `TRINKETS` with a REAL
// `ArrowRight` through Chromium's input pipeline held across one frame, which
// specs/ui.md has "set `menuIndex` and `almanacScroll` to `0`", so the entry the
// detail shows is the first of `PASSIVE_IDS`, which is Wick. Both the tab and
// the highlight are read back before the frame is.
//
// THE TOLERANCE. The name, the label and the line are matched folded —
// lower-cased, with spaces, dashes and underscores removed, across consecutive
// runs of text — so a build that letter-spaces a heading or wraps `MAX LEVEL`
// passes. The max level is read as a whole number standing alone, bounded by
// non-digits.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PASSIVES, PASSIVE_DESCRIPTIONS, STAT_LABELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertStat, openAlmanac, poseTab, tabIndex } from "./almanac";
import { assertShows, shown } from "./stage";

/** The tab and the entry this reads: the first of `PASSIVE_IDS`. */
const TRINKETS = tabIndex("TRINKETS");
const TRINKET = "wick";

/** Wick's row in specs/passives.md: "| Wick | `wick` | `5` | `+10%` ...". */
const MAX_LEVEL = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws Wick, MAX LEVEL 5 and Wick's line", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, TRINKETS);
  assertEqual(posed.almanacTab, TRINKETS, "the tab the detail is read on");
  assertEqual(posed.menuIndex, 0, "the entry the detail is read on");
  assertEqual(
    PASSIVES[TRINKET].maxLevel,
    MAX_LEVEL,
    "Wick's max level in specs/passives.md",
  );

  const page = await shown(h);
  await captureStill(h, "trinket");

  assertShows(page, PASSIVES[TRINKET].name, "the highlighted trinket's name");
  assertStat(page, STAT_LABELS.maxLevel, MAX_LEVEL, "the highlighted trinket");
  assertShows(
    page,
    PASSIVE_DESCRIPTIONS[TRINKET],
    "the highlighted trinket's description",
  );
});
