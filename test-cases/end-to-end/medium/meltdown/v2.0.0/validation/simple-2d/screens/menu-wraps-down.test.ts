// screens/menu-wraps-down — moving down from the last row of a menu highlights the
// first.
//
// THE RULE. specs/screens.md, Menus: "`up` and `down` move the highlight one row,
// and the highlight wraps at both ends: moving down from the last row highlights
// the first, and moving up from the first row highlights the last. This holds on
// every menu in the game."
//
// EVERY MENU, BECAUSE THAT IS WHAT THE RULE SAYS. The specification states the
// wrap of "every menu", not of one of them, so each of the six menus
// specs/screens.md gives rows to is its own check and a build that wraps its title
// menu but stops dead at the bottom of the pause menu fails on the menu it got
// wrong. `howto` and `playing` have no menu and are not among them.
//
// ONE DIRECTION, AT ONE END. That `down` moves the highlight one row in the
// ordinary case is `controls.menu-down`'s requirement, and the other end of the
// list is `screens.menu-wraps-up`'s. This item is the step off the bottom, so the
// highlight is posed on the LAST row outright and exactly one press is made.
//
// THE THREE SCREENS A PLAYER ONLY MEETS MID-RUN — `paused`, `victory` and
// `gameover` — are posed over a run, so the menu is drawn over the floor a player
// would have behind it rather than over the untouched fields of a title screen.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { MENUS, poseMenu } from "./menu";

/** The key specs/controls.md binds `down` to. */
const DOWN = BINDINGS.down[0];

/** The row the highlight wraps to: the first. */
const WRAPS_TO = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

for (const { screen, items } of MENUS) {
  it(`wraps the ${screen} menu from its last row to its first`, async () => {
    const lastRow = items.length - 1;
    poseMenu(h, screen, lastRow);
    await h.advance(1);
    const before = h.snapshot();
    assertEqual(
      before.screen,
      screen,
      "posing: the menu the press is made on (specs/screens.md)",
    );
    assertEqual(
      before.menuIndex,
      lastRow,
      `posing: the last of the ${items.length} rows the ${screen} menu ` +
        `draws (specs/screens.md)`,
    );

    await h.tap(DOWN);
    captureStill(h, "wrapped");

    assertEqual(
      h.snapshot().menuIndex,
      WRAPS_TO,
      `${DOWN} on row ${lastRow} of the ${items.length}-row ${screen} menu: ` +
        `the highlight wraps past the last row to the first ` +
        `(specs/screens.md, Menus)`,
    );
  });
}
