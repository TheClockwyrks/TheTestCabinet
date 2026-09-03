// screens/almanac-shows-tool-detail — the highlighted tool is shown in full: its
// name, its two figures, and its line of copy.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "The entry at
// `menuIndex` is shown in four parts", of which three are read here — "Name |
// The weapon's from `WEAPON_NAMES`", "Stats | The lines the table below names,
// each the label written exactly as it appears there and its figure beside it",
// and "Description | The entry's line from the Descriptions section below, on
// one line" — and the tab's row of that table: "`TOOLS` | ... | `DAMAGE` and the
// `damage` of its level `1` row, and `COOLDOWN` and that row's `cooldown` in
// seconds". Taper's level `1` row is specs/weapons.md's first Taper row,
// "| 1 | 10 | 1.35 | 120 | 40 | 1 |", so the two figures are `10` and `1.35`,
// and Taper's line is the `taper` entry of `WEAPON_DESCRIPTIONS`. The fourth
// part, the picture, is `almanac-draws-tool-picture`.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which stands it on the `TOOLS` tab with `menuIndex`
// `0`, and Taper is the first of `BASE_WEAPON_IDS`, so the entry the detail
// shows is the one the screen is entered on and no key is pressed at all.
//
// THE TOLERANCE. The name, the labels and the line are matched folded —
// lower-cased, with spaces, dashes and underscores removed, across consecutive
// runs of text — so a build that letter-spaces a heading or wraps a label passes.
// The damage is read as a whole number standing alone, bounded by non-digits, so
// a build that writes it inside a longer number fails; the cooldown is matched
// folded, so a build that writes a unit after it is read as showing it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { STAT_LABELS, WEAPON_DESCRIPTIONS, WEAPON_NAMES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertStat, openAlmanac, tabIndex } from "./almanac";
import { assertShows, shown } from "./stage";

/** The tab and the entry this reads: the first of `BASE_WEAPON_IDS`. */
const TOOLS = tabIndex("TOOLS");
const TOOL = "taper";

/** Taper's level `1` row of specs/weapons.md: "| 1 | 10 | 1.35 | 120 | 40 | 1 |". */
const DAMAGE = 10;
const COOLDOWN = 1.35;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws Taper, DAMAGE 10, COOLDOWN 1.35 and Taper's line", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.almanacTab, TOOLS, "the tab the detail is read on");
  assertEqual(opened.menuIndex, 0, "the entry the detail is read on");

  const page = await shown(h);
  await captureStill(h, "tool");

  assertShows(page, WEAPON_NAMES[TOOL], "the highlighted tool's name");
  assertStat(page, STAT_LABELS.damage, DAMAGE, "the highlighted tool");
  assertStat(page, STAT_LABELS.cooldown, COOLDOWN, "the highlighted tool");
  assertShows(
    page,
    WEAPON_DESCRIPTIONS[TOOL],
    "the highlighted tool's description",
  );
});
