// screens/menu-wraps-up — moving up from the first row of a menu highlights the
// last.
//
// THE RULE. specs/screens.md, Menus: "`up` and `down` move the highlight one row,
// and the highlight wraps at both ends: moving down from the last row highlights
// the first, and moving up from the first row highlights the last. This holds on
// every menu in the game."
//
// EVERY MENU, BECAUSE THAT IS WHAT THE RULE SAYS. Each of the six menus
// specs/screens.md gives rows to is its own check, so a build that wraps one and
// not another fails on the menu it got wrong. `howto` and `playing` have no menu.
//
// ONE DIRECTION, AT ONE END. That `up` moves the highlight back one in the
// ordinary case is `controls.menu-up`'s requirement, and the bottom of the list is
// `screens.menu-wraps-down`'s. This item is the step off the top: the highlight is
// posed on the FIRST row — which is also where a menu opens, so this is the wrap a
// player meets first — and exactly one press is made.
//
// THE ROW IS POSED OUTRIGHT even though `reset` leaves the highlight there, so the
// precondition rests on the pose rather than on `reset` being right.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { MENUS, poseMenu } from "./menu";

/** The key specs/controls.md binds `up` to. */
const UP = BINDINGS.up[0];

/** The row the press starts from: the first. */
const FIRST_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

for (const { screen, items } of MENUS) {
  it(`wraps the ${screen} menu from its first row to its last`, async () => {
    poseMenu(h, screen, FIRST_ROW);
    await h.advance(1);
    const before = h.snapshot();
    assertEqual(
      before.screen,
      screen,
      "posing: the menu the press is made on (specs/screens.md)",
    );
    assertEqual(
      before.menuIndex,
      FIRST_ROW,
      `posing: the first of the ${items.length} rows the ${screen} menu ` +
        `draws (specs/screens.md)`,
    );

    await h.tap(UP);
    captureStill(h, "wrapped");

    assertEqual(
      h.snapshot().menuIndex,
      items.length - 1,
      `${UP} on row ${FIRST_ROW} of the ${items.length}-row ${screen} menu: ` +
        `the highlight wraps past the first row to the last ` +
        `(specs/screens.md, Menus)`,
    );
  });
}
