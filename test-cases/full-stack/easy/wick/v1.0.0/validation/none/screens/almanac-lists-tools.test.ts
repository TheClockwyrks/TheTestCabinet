// screens/almanac-lists-tools — the `TOOLS` tab lists all sixteen weapon names,
// in order, a window at a time.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`") fixes the tab's
// entries and their order: "`TOOLS` | the ten of `BASE_WEAPON_IDS`, then the six
// of `EVOLUTION_IDS`", each row showing "its entry's name", drawn from
// `WEAPON_NAMES`, with the list "listed down the left". It fixes the window as
// well: "The list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at
// the entry at `almanacScroll`", and the window follows the highlight,
// "`almanacScroll` ... becomes the lesser of `almanacScroll` and `menuIndex`,
// then the greater of that and `menuIndex − ALMANAC_ROWS + 1`", so the highlight
// on the sixteenth entry leaves the window at `6` and the last ten names on
// show. The two windows together carry all sixteen.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which stands it on the `TOOLS` tab at its first entry,
// and the highlight is then walked to the last entry with REAL `ArrowDown`
// presses, one frame each. The window is read back at each stop, so a build
// whose window does not follow its highlight fails the point that owns that
// rather than being read against a list it is not showing.
//
// THE TOLERANCE. Each name is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text — so a build that
// letter-spaces a row or draws `Oil Splash` word by word passes. The order is
// read as a run of drawn anchors, one per name, each strictly below the one
// before it, because specs/ui.md fixes "no palette, no font, and no styling for
// any screen, and each screen's layout is yours": where the list begins and how
// far apart its rows sit are the build's, and only their order is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS, almanacNames, almanacScrollFor } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  assertListedInOrder,
  openAlmanac,
  poseEntry,
  tabIndex,
} from "./almanac";
import { shown } from "./stage";

/** The tab this reads, its sixteen names, and the last of them. */
const TOOLS = tabIndex("TOOLS");
const NAMES = almanacNames(TOOLS);
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

it("lists the first ten weapon names in order, then the last ten", async () => {
  const opened = await openAlmanac(h);
  assertEqual(opened.almanacTab, TOOLS, "the tab the list is read on");

  const top = await shown(h);
  await captureStill(h, "tools");
  assertListedInOrder(
    top,
    NAMES.slice(0, ALMANAC_ROWS),
    "the tools listed from the top of the list",
  );

  const posed = await poseEntry(h, LAST_ENTRY);
  assertEqual(
    posed.almanacScroll,
    LAST_WINDOW,
    "the window the highlight on the last entry left",
  );
  const bottom = await shown(h);
  assertListedInOrder(
    bottom,
    NAMES.slice(LAST_WINDOW, LAST_WINDOW + ALMANAC_ROWS),
    "the tools listed from the end of the list",
  );
});
