// screens/almanac-lists-trinkets — the `TRINKETS` tab lists all ten passive
// names, in order.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`almanac`") fixes the tab's
// entries and their order: "`TRINKETS` | the ten of `PASSIVE_IDS`", each row
// showing "its entry's name", which for a passive is "The passive's from
// `PASSIVES`", and the entries are "listed down the left". The tab holds exactly
// `ALMANAC_ROWS` (`10`) entries, and "a tab of `ALMANAC_ROWS` entries or fewer
// shows all of them", so one frame carries the whole list.
//
// WHY THE WORLD IS POSED AS IT IS. The almanac is entered through
// `setScreen("almanac")`, which stands it on the first tab, and the tab is
// walked to `TRINKETS` with a REAL `ArrowRight` through Chromium's input
// pipeline held across one frame. The tab is read back before the list is, so a
// build whose `right` is broken fails the point that owns it rather than this
// one.
//
// THE TOLERANCE. Each name is matched folded — lower-cased, with spaces, dashes
// and underscores removed, across consecutive runs of text — so a build that
// letter-spaces a row or draws it word by word passes. The order is read as a
// run of drawn anchors, one per name, each strictly below the one before it,
// because specs/ui.md fixes "no palette, no font, and no styling for any
// screen, and each screen's layout is yours".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ALMANAC_ROWS, almanacNames } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { assertListedInOrder, openAlmanac, poseTab, tabIndex } from "./almanac";
import { shown } from "./stage";

/** The tab this reads, and its ten names. */
const TRINKETS = tabIndex("TRINKETS");
const NAMES = almanacNames(TRINKETS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lists the ten passive names in order on one frame", async () => {
  await openAlmanac(h);
  const posed = await poseTab(h, TRINKETS);
  assertEqual(posed.almanacTab, TRINKETS, "the tab the list is read on");
  assertEqual(
    NAMES.length,
    ALMANAC_ROWS,
    "the trinkets the tab holds, which the window shows all of",
  );

  const page = await shown(h);
  await captureStill(h, "trinkets");

  assertListedInOrder(page, NAMES, "the trinkets listed");
});
