// screens/almanac-shows-enemy-detail — the highlighted enemy is shown in full:
// its name, its three figures, and its line of copy.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "The entry at
// `menuIndex` is shown in four parts", of which three are read here — "Name |
// The ... enemy's from `ENEMIES`", "Stats | The lines the table below names,
// each the label written exactly as it appears there and its figure beside it",
// and "Description | The entry's line from the Descriptions section below, on
// one line" — and the tab's row of that table: "`ENEMIES` | the enemy's walk
// sheet, animated at `WALK_FRAME_TIME` | `HEALTH`, `SPEED`, and `DAMAGE`, and
// the `hp`, `speed`, and `damage` of its row in `ENEMIES`". The Moth's row in
// specs/enemies.md is "| Moth | `moth` | 5 | 100 | 5 | 10 | small | chase |", so
// the three figures are `5`, `100` and `5`, and the Moth's line is the `moth`
// entry of `ENEMY_DESCRIPTIONS`. The fourth part, the picture, is
// `almanac-draws-enemy-animation`.
//
// WHY THE WORLD IS POSED AS IT IS. The tab is walked to `ENEMIES` with REAL
// `ArrowRight` presses through Chromium's input pipeline, one frame each, which
// specs/ui.md has "set `menuIndex` and `almanacScroll` to `0`", so the entry the
// detail shows is the first of `ENEMY_IDS`, which is the Moth. Both the tab and
// the highlight are read back before the frame is.
//
// THE TOLERANCE. The name, the labels and the line are matched folded —
// lower-cased, with spaces, dashes and underscores removed, across consecutive
// runs of text. Each figure is read as a whole number standing alone, bounded by
// non-digits, so a build that writes one inside a longer number fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENEMIES, ENEMY_DESCRIPTIONS, STAT_LABELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertStat, openAlmanac, poseTab, tabIndex } from "./almanac";
import { assertShows, shown } from "./stage";

/** The tab and the entry this reads: the first of `ENEMY_IDS`. */
const ENEMIES_TAB = tabIndex("ENEMIES");
const ENEMY = "moth";

/** The Moth's row in specs/enemies.md: "| Moth | `moth` | 5 | 100 | 5 | ...". */
const HEALTH = 5;
const SPEED = 100;
const DAMAGE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws Moth, HEALTH 5, SPEED 100, DAMAGE 5 and the Moth's line", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, ENEMIES_TAB);
  assertEqual(posed.almanacTab, ENEMIES_TAB, "the tab the detail is read on");
  assertEqual(posed.menuIndex, 0, "the entry the detail is read on");

  const page = await shown(h);
  await captureStill(h, "enemy");

  assertShows(page, ENEMIES[ENEMY].name, "the highlighted enemy's name");
  assertStat(page, STAT_LABELS.health, HEALTH, "the highlighted enemy");
  assertStat(page, STAT_LABELS.speed, SPEED, "the highlighted enemy");
  assertStat(page, STAT_LABELS.damage, DAMAGE, "the highlighted enemy");
  assertShows(
    page,
    ENEMY_DESCRIPTIONS[ENEMY],
    "the highlighted enemy's description",
  );
});
