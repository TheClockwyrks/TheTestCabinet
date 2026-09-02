// Wick — screens/almanac-lists-pickups: the `PICKUPS` tab lists the three gems
// and the three pickups, in order.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`almanac`", gives
// the `PICKUPS` tab "the three of `GEM_TIERS`, then the three of
// `PICKUP_KINDS`", in that order, and their names in the table "The gems and
// the pickups carry the display names `GEM_NAMES` and `PICKUP_NAMES` give
// them": `Small Gem`, `Medium Gem`, `Large Gem`, `Chest`, `Bread`, `Draft`.
// "a tab of `ALMANAC_ROWS` entries or fewer shows all of them", so the six are
// one window and the whole list is on one frame.
//
// WHAT IS READ. The names the frame drew and the order it drew them down the
// stage. Where the list sits, its pitch, and the type it is set in are the
// build's (`specs/ui.md`, Presentation), so the reading is which names
// appeared and which of them sits above which. A name is matched as a
// SUBSTRING, so a build that marks the highlighted row or pads its rows still
// reads as having drawn it.
//
// THE DRIVE. `reset`, the almanac posed through the debug surface, three
// `ArrowRight` presses onto the fourth tab, and one frame. The tab is read
// from the snapshot before the frame is judged.
//
// THE TOLERANCE. The names are exact, ignoring case and surrounding
// characters. The order is strict: each name is drawn strictly below the one
// before it, since two rows drawn at one height are not a list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { ALMANAC_ENTRY_COUNTS, ALMANAC_ROWS, ALMANAC_TABS } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  textDraws,
  type Harness,
} from "../harness";
import { moveTab, outOfOrder, windowNames } from "./almanac";

/** The tab read, and where it sits on the bar. */
const TAB = "PICKUPS";
const AT = ALMANAC_TABS.indexOf(TAB);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the six gem and pickup names in order on one frame", async () => {
  h.reset();
  poseScreen(h, "almanac");

  const shown = await moveTab(h, AT);
  assertEqual(shown.almanacTab, AT, "the tab the almanac is showing");
  assertEqual(shown.almanacScroll, 0, "the list's first visible row");

  const { calls } = await h.frameDraw();
  captureStill(h, "pickups");

  const names = windowNames(TAB, shown.almanacScroll);
  assertEqual(
    names.length,
    ALMANAC_ENTRY_COUNTS[TAB],
    `entries the ${TAB} tab shows at once, its whole list being no longer than ALMANAC_ROWS (${ALMANAC_ROWS})`,
  );
  assertNull(
    outOfOrder(textDraws(calls), names),
    `the first name drawn out of ${TAB} order, of ${names.join(", ")} (specs/ui.md, almanac)`,
  );
});
