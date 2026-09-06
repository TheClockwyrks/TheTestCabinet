// screens/almanac-shows-pickup-detail — the highlighted pickup is shown in full:
// its name, its figure, and its line of copy.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`"): "The entry at
// `menuIndex` is shown in four parts", of which three are read here — "Name |
// The ... gem's or the pickup's from the names below", the table giving
// `GEM_NAMES` `small` the name `Small Gem`; "Stats | The lines the table below
// names, each the label written exactly as it appears there and its figure
// beside it", the tab's row reading "`PICKUPS` | the gem's or the pickup's
// sprite | a gem: `EXPERIENCE` and its tier's value in `GEM_VALUES`"; and
// "Description | The entry's line from the Descriptions section below, on one
// line". specs/world.md gives the small tier's value, "| `small` | `1` |", so
// the figure is `1`, and the line is the `small` entry of `GEM_DESCRIPTIONS`.
// The fourth part, the sprite, is the presentation category's.
//
// WHY THE WORLD IS POSED AS IT IS. The tab is walked to `PICKUPS` with REAL
// `ArrowRight` presses through Chromium's input pipeline, one frame each, which
// specs/ui.md has "set `menuIndex` and `almanacScroll` to `0`", so the entry the
// detail shows is the first of `GEM_TIERS`, which is the small gem. Both the tab
// and the highlight are read back before the frame is.
//
// THE TOLERANCE. The name, the label and the line are matched ignoring case
// and whitespace, across the runs of text the frame drew joined in reading
// order (the shared harness's `drewTextAnywhere`) — so a build that draws
// `Small Gem` word by word passes. The
// experience is read as a whole number standing alone, bounded by non-digits.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GEM_DESCRIPTIONS, GEM_NAMES, STAT_LABELS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertStat, openAlmanac, poseTab, tabIndex } from "./almanac";
import { assertShows, shown } from "./stage";

/** The tab and the entry this reads: the first of `GEM_TIERS`. */
const PICKUPS = tabIndex("PICKUPS");
const TIER = "small";

/** The small tier's row in specs/world.md: "| `small` | `1` |". */
const EXPERIENCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws Small Gem, EXPERIENCE 1 and the small gem's line", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, PICKUPS);
  assertEqual(posed.almanacTab, PICKUPS, "the tab the detail is read on");
  assertEqual(posed.menuIndex, 0, "the entry the detail is read on");

  const page = await shown(h);
  await captureStill(h, "pickup");

  assertShows(page, GEM_NAMES[TIER], "the highlighted pickup's name");
  assertStat(page, STAT_LABELS.experience, EXPERIENCE, "the highlighted gem");
  assertShows(
    page,
    GEM_DESCRIPTIONS[TIER],
    "the highlighted pickup's description",
  );
});
