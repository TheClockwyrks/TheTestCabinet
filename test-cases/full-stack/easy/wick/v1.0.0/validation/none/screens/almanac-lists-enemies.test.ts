// screens/almanac-lists-enemies — the `ENEMIES` tab lists all thirteen enemy
// names, in order, a window at a time.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`") fixes the tab's
// entries and their order: "`ENEMIES` | the thirteen of `ENEMY_IDS`", each row
// showing "its entry's name", which for an enemy is "The ... enemy's from
// `ENEMIES`", and the entries are "listed down the left". It fixes the window as
// well: "The list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at
// the entry at `almanacScroll`", and the window follows the highlight,
// "`almanacScroll` ... becomes the lesser of `almanacScroll` and `menuIndex`,
// then the greater of that and `menuIndex − ALMANAC_ROWS + 1`", so the highlight
// on the thirteenth entry leaves the window at `3`. The two windows together
// carry all thirteen.
//
// WHY THE WORLD IS POSED AS IT IS. The tab is walked to `ENEMIES` with REAL
// `ArrowRight` presses and the highlight to the last entry with REAL `ArrowDown`
// presses, one frame each, and the tab and the window are read back at each stop
// so a build whose keys or whose window are broken fail the points that own them
// rather than being read against a list they are not showing.
//
// THE TOLERANCE. Each name is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text. The order is read as
// a run of drawn anchors, one per name, each strictly below the one before it,
// because specs/ui.md fixes "no palette, no font, and no styling for any
// screen, and each screen's layout is yours". `Moth` is a part of `Mothwing`, so
// the run is chosen by taking the lowest anchor still available at each step,
// which finds a run whenever the frame holds one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS, almanacNames, almanacScrollFor } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertListedInOrder,
  openAlmanac,
  poseEntry,
  poseTab,
  tabIndex,
} from "./almanac";
import { shown } from "./stage";

/** The tab this reads, its thirteen names, and the last of them. */
const ENEMIES_TAB = tabIndex("ENEMIES");
const NAMES = almanacNames(ENEMIES_TAB);
const LAST_ENTRY = NAMES.length - 1;

/** The window the highlight on the last entry leaves, by specs/ui.md's rule. */
const LAST_WINDOW = almanacScrollFor(0, LAST_ENTRY, NAMES.length);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists the first ten enemy names in order, then the last ten", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, ENEMIES_TAB);
  assertEqual(posed.almanacTab, ENEMIES_TAB, "the tab the list is read on");

  const top = await shown(h);
  await captureStill(h, "enemies");
  assertListedInOrder(
    top,
    NAMES.slice(0, ALMANAC_ROWS),
    "the enemies listed from the top of the list",
  );

  const walked = await poseEntry(h, LAST_ENTRY);
  assertEqual(
    walked.almanacScroll,
    LAST_WINDOW,
    "the window the highlight on the last entry left",
  );
  const bottom = await shown(h);
  assertListedInOrder(
    bottom,
    NAMES.slice(LAST_WINDOW, LAST_WINDOW + ALMANAC_ROWS),
    "the enemies listed from the end of the list",
  );
});
