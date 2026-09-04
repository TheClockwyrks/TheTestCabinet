// screens/end-menu-returns-to-title-from-victory — confirming MENU on the victory screen returns to the
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
import { BINDINGS, ENDING_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseMenu } from "./menu";

/** The key specs/controls.md binds `confirm` to. */
const CONFIRM = BINDINGS.confirm[0];

/** The row `MENU` sits on, second of the two `ENDING_ITEMS`. */
const MENU_ROW = 1;

/** The screen the row is confirmed on (specs/screens.md). */
const SCREEN = "victory" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title from the victory screen", async () => {
  assertEqual(
    ENDING_ITEMS[MENU_ROW],
    "MENU",
    "posing: the row this item is about (specs/screens.md, ENDING_ITEMS)",
  );
  poseMenu(h, SCREEN, MENU_ROW);
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    SCREEN,
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
    `${CONFIRM} on the MENU row of the victory screen: the screen it ` +
      `leads to (specs/screens.md)`,
  );
});
