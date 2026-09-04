// Meltdown — screens/end-menu-returns-to-title: MENU leaves either end screen for
// the title.
//
// THE RULE. specs/screens.md, `victory` and `gameover`: of the two rows of
// `ENDING_ITEMS`, `MENU` leads to `title` — and the table applies to both screens.
//
// BOTH SCREENS, because the rule is stated of either of them and a build that
// wired the row on one screen and not the other is an ordinary defect. The failure
// names the screen whose MENU row did not lead home.
//
// AND IT IS THE SECOND ROW, NOT THE FIRST. specs/screens.md gives `PLAY AGAIN` a
// different destination entirely — a fresh run — so a build that wires both rows to
// the same thing reads `playing` here. That is asserted against directly: the
// screen must be `title` and must not be `playing`, which is the answer a build
// that confused the two rows gives.
//
// THE SCREENS ARE POSED OUTRIGHT. specs/instrumentation.md's `setScreen` runs no
// entry effect, and none is wanted: this item is about where a row LEADS, and the
// entry effect — that the highlight opens on `PLAY AGAIN` — is
// `screens.play-again-focused`'s requirement, reached there through the run's own
// transition. The row is posed rather than walked, so a build whose arrow keys are
// broken still gets a fair reading of what its MENU row does.
//
// THE ROW INDEX COMES OFF `ENDING_ITEMS` rather than being written as `1`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
  type Screen,
} from "../harness";

/** The row confirmed: `MENU`, the second of the two `ENDING_ITEMS`. */
const MENU_ROW = ENDING_ITEMS.indexOf("MENU");

/** The two screens the rule is stated of. */
const END_SCREENS: readonly Screen[] = ["victory", "gameover"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when MENU is confirmed on either end screen", async () => {
  for (const screen of END_SCREENS) {
    resetTo(h);
    h.debug.setScreen(screen);
    h.debug.setMenuIndex(MENU_ROW);
    await h.advance(1);

    const before = h.snapshot();
    assertEqual(
      before.screen,
      screen,
      `${screen}: the screen the leg is posed on`,
    );
    assertEqual(
      before.menuIndex,
      MENU_ROW,
      `${screen}: the row the leg is posed on`,
    );

    await tapAction(h, "confirm");
    if (screen === END_SCREENS[0]) captureStill(h, "title");

    const after = h.snapshot();
    assertNotEqual(
      after.screen,
      "playing",
      `${screen}: MENU leaves for the title rather than replaying the run`,
    );
    assertEqual(
      after.screen,
      "title",
      `${screen}: the screen confirming row ${MENU_ROW} of the end menu leads to`,
    );
  }
});
