// screens/almanac-lists-pickups — the `PICKUPS` tab lists the three gems and the
// three pickups, in order.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`") fixes the tab's
// entries and their order: "`PICKUPS` | the three of `GEM_TIERS`, then the three
// of `PICKUP_KINDS`", each row showing "its entry's name", which for these six
// is the table of display names the same section carries: `Small Gem`,
// `Medium Gem`, `Large Gem`, `Chest`, `Bread`, `Draft`. The entries are "listed
// down the left", and the tab holds fewer than `ALMANAC_ROWS` (`10`), so "a tab
// of `ALMANAC_ROWS` entries or fewer shows all of them" and one frame carries
// the whole list.
//
// WHY THE WORLD IS POSED AS IT IS. The tab is walked to `PICKUPS` with REAL
// `ArrowRight` presses through Chromium's input pipeline, one frame each, and
// read back before the list is, so a build whose `right` is broken fails the
// point that owns it rather than this one.
//
// THE TOLERANCE. Each name is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text — so a build that
// draws `Small Gem` word by word passes. The order is read as a run of drawn
// anchors, one per name, each strictly below the one before it, because
// specs/ui.md fixes "no palette, no font, and no styling for any screen, and
// each screen's layout is yours".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { ALMANAC_ROWS, almanacNames } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertListedInOrder, openAlmanac, poseTab, tabIndex } from "./almanac";
import { shown } from "./stage";

/** The tab this reads, and its six names. */
const PICKUPS = tabIndex("PICKUPS");
const NAMES = almanacNames(PICKUPS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists the three gems and the three pickups in order on one frame", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, PICKUPS);
  assertEqual(posed.almanacTab, PICKUPS, "the tab the list is read on");
  assertLessThanOrEqual(
    NAMES.length,
    ALMANAC_ROWS,
    "the pickups the tab holds, which the window shows all of",
  );

  const page = await shown(h);
  await captureStill(h, "pickups");

  assertListedInOrder(page, NAMES, "the pickups listed");
});
