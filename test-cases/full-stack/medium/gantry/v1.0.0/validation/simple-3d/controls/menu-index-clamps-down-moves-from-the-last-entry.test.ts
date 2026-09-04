// controls/menu-index-clamps-down-moves-from-the-last-entry — with no entry at
// the held index, `down` moves from the menu's last entry.
//
// `specs/state.md` § The session: "A screen with no menu highlights nothing and
// leaves it as it stands, and a menu with no entry at that index highlights its
// last entry instead: `confirm` takes the highlighted entry, and `up` and `down`
// move from it (`specs/ui.md`)." § The screens of `specs/ui.md` gives what a move
// is: "`up` and `down` move the highlight by one entry and wrap at both ends."
//
// SO THE SCENARIO HAS TO PUT THE HELD INDEX PAST A MENU'S END, and the
// specification supplies exactly the way: `setScreen` "shows a named screen and
// sets nothing else; `menuIndex` is left as it stands", and `setMenuIndex`'s
// "domain is the entry count of the menu that screen shows". So the index is set
// on the site select, whose menu is the `SITE_COUNT` (`6`) sites, and the screen
// is then taken to `results` — which on the last site leaves out `NEXT SITE` and
// carries "the other two entries in the same order" (`specs/ui.md` § Results).
// Index `2` names no entry of a two-entry menu.
//
// THE READING IS WHERE `down` LANDS. Moving from the LAST entry — index `1` — is
// a move off the end, so it wraps to `0`. A build that moved from the held index
// instead lands at `3` or wherever its own arithmetic takes it, and a build that
// clamped to the first entry before moving lands at `1`, so the reading separates
// the conforming answer from both.
//
// The last site is opened with `openSite(5)`, which reaches any site "locked or
// not ... without playing to it".

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, RESULTS_ITEMS, SITE_COUNT } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The `down` action's binding, as `specs/controls.md` fixes it. */
const DOWN = BINDINGS.down[0]!;

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

it("wraps to the first entry when down moves from the clamped last entry", async () => {
  await openSite(h, SITE);
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HELD);
  await h.debug.setScreen("results");
  const posed = await h.snapshot();
  assertEqual(posed.screen, "results", "the menu screen the press lands on");
  assertEqual(posed.siteIndex, SITE, "the site whose results are showing");
  assertEqual(
    posed.menuIndex,
    HELD,
    "the index the menu is left holding: `setScreen` sets nothing else " +
      "(specs/instrumentation.md)",
  );

  await h.press(DOWN);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).menuIndex,
    0,
    `menuIndex after ${DOWN} with menuIndex ${HELD} held on a menu of ` +
      `${ENTRIES} entries: the menu highlights its last entry instead and ` +
      "`down` moves from it, wrapping off the end " +
      "(specs/state.md § The session, specs/ui.md § The screens)",
  );

  await h.capture(
    "state",
    "the results menu after down moved from its last entry",
  );
});
