// Meltdown — screens/end-menu-returns-to-title-from-victory — confirming MENU on the victory screen returns to the
// title.
//
// THE RULE. `specs/screens.md`, on `victory` and `gameover`: both "draw the two
// rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`", and `MENU` leads to `title`.
//
// ONE SCREEN, BECAUSE THE TWO ARE TWO SCREENS. `victory` and `gameover` are
// reached by different paths and are commonly built separately, so a build that
// wired the row on one and left it dead on the other must not grade as one that
// wired neither. The other end screen is
// `screens.end-menu-returns-to-title-from-gameover`'s.
//
// THE SECOND ROW, WHICH IS THE WHOLE POINT. `modes.replay-keeps-the-mode-from-victory`
// reads where the FIRST row leads, and the two rows lead to different places — a
// build that sent both to a fresh run reads `playing` here.
//
// THE SCREEN IS POSED, NOT REACHED. `setScreen` sets the field alone and runs no
// entry effect (`specs/instrumentation.md`), which is what this item wants: where
// a row leads is not an entry effect, and reaching victory through the run's own
// transitions would make this verdict depend on the wave rules, which are
// `waves.victory-on-clearing-the-final-wave`'s. What the screen shows the moment it opens IS an entry
// effect, and that is `screens.play-again-focused-on-victory`'s.
//
// THE RUN BEHIND THE MENU IS LEFT WHERE THE HARNESS PUT IT, because nothing about
// this row depends on it: the reading is the screen the press leads to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `MENU`, the second of the two `ENDING_ITEMS`. */
const MENU_ROW = ENDING_ITEMS.indexOf("MENU");

/** The screen the row is confirmed on. */
const SCREEN = "victory" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title when MENU is confirmed on the victory screen", async () => {
  const { debug } = h;
  const where = `${ENDING_ITEMS[MENU_ROW]}, row ${MENU_ROW} of ${ENDING_ITEMS.length} on ${SCREEN}`;

  await startRun(h);
  await debug.setScreen(SCREEN);
  await debug.setMenuIndex(MENU_ROW);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    SCREEN,
    `the screen the scenario is posed on, for ${where}`,
  );
  assertEqual(posed.menuIndex, MENU_ROW, `the row posed for ${where}`);

  await tapAction(h, "confirm");
  await h.advance(1);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(after.screen, "title", `the screen confirming ${where} leads to`);
});
