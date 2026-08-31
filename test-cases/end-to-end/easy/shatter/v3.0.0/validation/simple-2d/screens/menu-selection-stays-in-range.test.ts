// screens/menu-selection-stays-in-range — a menu's highlight never leaves that
// menu's own entries.
//
// THE RULE. `specs/controls.md`, "Menus": "the up and down inputs move the
// highlight by one entry and wrap at both ends, so moving down from the last entry
// highlights the first and moving up from the first highlights the last. The
// highlight is therefore always on one of the menu's own entries."
// `specs/instrumentation.md` reports it as `menuIndex`, "the highlighted entry,
// from `0`". So on every menu, at every moment, `menuIndex` names an entry of THAT
// menu: a whole number from `0` up to one below its entry count.
//
// WHY THIS IS AN ITEM OF ITS OWN, BESIDE THE FIVE `controls` MOVE ITEMS. Those
// grade ONE press of ONE key from a posed entry. This grades the invariant they
// leave open: an index that walked off the end. A build that clamps rather than
// wraps still keeps every index in range and passes here, as it should — the wrap
// itself is `controls/menu-up-arrow`'s and `controls/menu-down-arrow`'s to grade —
// while a build that let the index run to `2` on a two-entry menu, or to `-1` at
// the top, hands its own confirm an entry that does not exist. `specs/ui.md`
// fixes different entry counts for the three menus (two, three, two), so an index
// carried over from one menu is out of range on another; every menu is therefore
// driven, not just one.
//
// THE DRIVE. `PRESSES` presses of the down key, then `PRESSES` of the up key, each
// a real key event at the target the engine listens on through the key
// `specs/controls.md` binds to the action. `PRESSES` is more than any of the three
// menus is long, so each direction is walked off the end of its menu several times
// over. The index is read after EVERY press rather than at the end, so a build
// that strayed out of range and came back is caught at the press that took it out;
// the failure names the menu and the press.
//
// THE SCREENS ARE POSED. `setScreen` puts each of the three menus up directly
// (`specs/instrumentation.md`), and the field beneath the pause menu is emptied and
// quiet first, so nothing arrives mid-drive. Confirm is never pressed, so no drive
// leaves the screen it is walking.
//
// WHAT THIS ITEM DOES NOT DECIDE. Which direction each key moves the highlight, or
// that it wraps — the five `controls` items — nor which entry the highlighted one
// is drawn as, which is `screens/title-menu-highlight`.

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "../../src/constants";
import { assertBetween, assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  type Harness,
  type Screen,
} from "../harness";

/**
 * How many times each direction is driven, on each menu.
 *
 * The figure the item's own description fixes, and comfortably more than the
 * longest of the three menus: ten presses walk a two-entry menu off its end five
 * times and a three-entry menu three times, in each direction.
 */
const PRESSES = 10;

/** The three screens `specs/ui.md` gives a menu, and the entries it gives each. */
const MENUS: readonly { screen: Screen; items: readonly string[] }[] = [
  { screen: "title", items: TITLE_ITEMS },
  { screen: "paused", items: PAUSE_ITEMS },
  { screen: "gameover", items: GAMEOVER_ITEMS },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps menuIndex inside every menu's own entries, in both directions", async () => {
  // A quiet, empty field under the pause menu, so nothing arrives mid-drive.
  startPlaying(h);

  for (const menu of MENUS) {
    h.debug.setScreen(menu.screen);
    h.debug.setMenuIndex(0);
    assertEqual(
      h.snapshot().screen,
      menu.screen,
      "the screen the menu was posed on",
    );

    for (const action of ["down", "up"] as const) {
      for (let press = 1; press <= PRESSES; press += 1) {
        await h.tap(keyFor(action));
        const where = `${menu.screen}, press ${press} of ${action}`;
        const { menuIndex, screen } = h.snapshot();
        assertEqual(screen, menu.screen, `the screen still showing (${where})`);
        assertTrue(
          Number.isInteger(menuIndex),
          `menuIndex naming a whole entry of the ${menu.screen} menu ` +
            `(specs/instrumentation.md; ${where}) — it read ${menuIndex}`,
        );
        assertBetween(
          menuIndex,
          0,
          menu.items.length - 1,
          `menuIndex inside the ${menu.items.length} entries specs/ui.md ` +
            `gives the ${menu.screen} menu (${where})`,
        );
      }
    }
  }

  captureStill(h, "menu");
});
