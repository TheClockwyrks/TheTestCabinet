// controls/menu-index-clamps-confirm-takes-the-last-entry — with no entry at the
// held index, `confirm` takes the menu's last entry.
//
// `specs/state.md` § The session: "A screen with no menu highlights nothing and
// leaves it as it stands, and a menu with no entry at that index highlights its
// last entry instead: `confirm` takes the highlighted entry, and `up` and `down`
// move from it (`specs/ui.md`)."
//
// SO THE SCENARIO HAS TO PUT THE HELD INDEX PAST A MENU'S END, and the
// specification supplies exactly the way: `setScreen` "shows a named screen and
// sets nothing else; `menuIndex` is left as it stands", and `setMenuIndex`'s
// "domain is the entry count of the menu that screen shows". So the index is set
// on the site select, whose menu is the `SITE_COUNT` (`6`) sites, and the screen
// is then taken to `results` — which on the last site leaves out `NEXT SITE` and
// carries "the other two entries in the same order", `REPLAY` and `SITE SELECT`
// (`specs/ui.md` § Results). Index `2` names no entry of a two-entry menu.
//
// THE READING IS WHERE `confirm` LEADS, because that is what the rule is for: the
// highlighted entry is the menu's LAST, `SITE SELECT`, which "Returns to
// `select`, opening no site". A build that clamped to the first entry instead
// takes `REPLAY`, which "Opens this site again and shows its `build` screen", and
// a build that took no entry at all stays on `results` — three different screens,
// so the reading separates all three.
//
// The last site is opened with `openSite(5)`, which reaches any site "locked or
// not ... without playing to it".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, RESULTS_ITEMS, SITE_COUNT } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `confirm` action's binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** The last site, whose results menu leaves `NEXT SITE` out. */
const SITE = SITE_COUNT - 1;

/** The entries that menu carries: `RESULTS_ITEMS` without `NEXT SITE`. */
const ENTRIES = RESULTS_ITEMS.length - 1;

/** The index held: past the end of a menu of `ENTRIES` entries. */
const HELD = ENTRIES;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the results menu's last entry when the held index names none", async () => {
  await openSite(h, SITE);
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HELD);
  await h.debug.setScreen("results");
  const posed = await h.snapshot();
  assertEqual(posed.screen, "results", "the menu screen `confirm` is taken on");
  assertEqual(posed.siteIndex, SITE, "the site whose results are showing");
  assertEqual(
    posed.menuIndex,
    HELD,
    "the index the menu is left holding: `setScreen` sets nothing else " +
      "(specs/instrumentation.md)",
  );

  await h.press(CONFIRM);
  await h.advance(1);

  const after = await h.snapshot();

  await h.capture("state", "the screen the menu's last entry led to");

  assertEqual(
    after.screen,
    "select",
    `the screen after ${CONFIRM} with menuIndex ${HELD} held on a menu of ` +
      `${ENTRIES} entries: the menu highlights its last entry instead, ` +
      "`SITE SELECT`, which returns to `select` " +
      "(specs/state.md § The session, specs/ui.md § Results)",
  );
});
