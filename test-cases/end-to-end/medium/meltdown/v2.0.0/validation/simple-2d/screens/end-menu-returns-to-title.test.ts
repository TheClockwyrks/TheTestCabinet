// screens/end-menu-returns-to-title — confirming MENU on either end screen returns
// to the title.
//
// THE RULE. specs/screens.md's `victory and gameover` section: both screens draw
// the two rows of `ENDING_ITEMS`, and the `MENU` row leads to `title` from either
// of them.
//
// BOTH SCREENS, BECAUSE THE RULE IS STATED OF BOTH. A build that wires the row on
// the screen it happened to test and not on the other leaves a player who lost the
// run stuck on the game-over screen, so each end screen is its own check and the
// grade names the one that failed.
//
// THE OTHER ROW IS NOT THIS ITEM'S. `PLAY AGAIN` opens a fresh run on the same
// mode and difficulty, which is `modes.replay-keeps-the-mode`'s requirement, and
// which row is highlighted when the screen opens is
// `screens.play-again-focused`'s. This item is the second row and where it leads.
//
// THE SCREEN IS POSED OVER A REAL RUN and the highlight is posed on the row, so
// what is graded is the press. `setScreen` runs no entry effect
// (specs/instrumentation.md), and whether `down` could have reached the row is
// `controls.menu-down`'s requirement rather than a precondition this item should
// rest on.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, ENDING_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  type Harness,
  type Screen,
} from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `MENU` sits on, second of the two `ENDING_ITEMS`. */
const MENU_ROW = 1;

/** The two screens a run can end on (specs/screens.md). */
const END_SCREENS: readonly Screen[] = ["victory", "gameover"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

for (const screen of END_SCREENS) {
  it(`returns to the title from the ${screen} screen`, async () => {
    assertEqual(
      ENDING_ITEMS[MENU_ROW],
      "MENU",
      "posing: the row this item is about (specs/screens.md, ENDING_ITEMS)",
    );
    poseMenu(h, screen, MENU_ROW);
    await h.advance(1);
    const before = h.snapshot();
    assertEqual(
      before.screen,
      screen,
      "posing: the screen the press is made on (specs/screens.md)",
    );
    assertEqual(
      before.menuIndex,
      MENU_ROW,
      "posing: the row the press is made on (specs/screens.md)",
    );

    await h.tap(CONFIRM);
    captureStill(h, "title");

    assertEqual(
      h.snapshot().screen,
      "title",
      `${CONFIRM} on the MENU row of the ${screen} screen: the screen it ` +
        `leads to (specs/screens.md)`,
    );
  });
}
