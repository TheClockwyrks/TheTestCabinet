// Meltdown — screens/end-menu-returns-to-title-from-gameover — confirming MENU on the gameover screen returns to the
// title.
//
// THE RULE. `specs/screens.md`, on `victory` and `gameover`: both "draw the two
// rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`", and `MENU` leads to `title`.
//
// ONE SCREEN, BECAUSE THE TWO ARE TWO SCREENS. `victory` and `gameover` are
// reached by different paths and are commonly built separately, so a build that
// wired the row on one and left it dead on the other must not grade as one that
// wired neither. The other end screen is
// `screens.end-menu-returns-to-title-from-victory`'s.
//
// THE SECOND ROW, WHICH IS THE WHOLE POINT. `modes.replay-keeps-the-mode-from-gameover`
// reads where the FIRST row leads, and the two rows lead to different places — a
// build that sent both to a fresh run reads `playing` here.
//
// THE SCREEN IS POSED, NOT REACHED. `setScreen` sets the field alone and runs no
// entry effect (`specs/instrumentation.md`), which is what this item wants: where
// a row leads is not an entry effect, and reaching gameover through the run's own
// transitions would make this verdict depend on the wave rules, which are
// `waves.game-over-at-zero-lives`'s. What the screen shows the moment it opens IS an entry
// effect, and that is `screens.play-again-focused-on-gameover`'s.
//
// THE RUN BEHIND THE MENU IS LEFT WHERE THE HARNESS PUT IT, because nothing about
// this row depends on it: the reading is the screen the press leads to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `MENU`, the second of the two `ENDING_ITEMS`. */
const MENU_ROW = ENDING_ITEMS.indexOf("MENU");

/** The screen the row is confirmed on. */
const SCREEN = "gameover" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when MENU is confirmed on the gameover screen", async () => {
  resetTo(h);
  h.debug.setScreen(SCREEN);
  h.debug.setMenuIndex(MENU_ROW);
  await h.advance(1);

  const before = h.snapshot();
  assertEqual(before.screen, SCREEN, "the screen the leg is posed on");
  assertEqual(before.menuIndex, MENU_ROW, "the row the leg is posed on");

  await tapAction(h, "confirm");
  captureStill(h, "title");

  const after = h.snapshot();
  assertNotEqual(
    after.screen,
    "playing",
    "MENU leaves for the title rather than replaying the run",
  );
  assertEqual(
    after.screen,
    "title",
    `the screen confirming row ${MENU_ROW} of the gameover menu leads to`,
  );
});
