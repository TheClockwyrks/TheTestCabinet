// Meltdown — screens/end-menu-returns-to-title: MENU returns to the title from
// either end screen.
//
// THE RULE. `specs/screens.md`, for `victory` and `gameover` together: both "draw
// the two rows of `ENDING_ITEMS`, `PLAY AGAIN` and `MENU`", and `MENU` leads to
// `title`. One requirement over two screens, so both are read.
//
// THE SECOND ROW, WHICH IS THE WHOLE POINT. `modes.replay-keeps-the-mode` reads
// where the FIRST row leads, so a build that wired PLAY AGAIN and left MENU dead
// grades differently from one that wired neither, and the two rows lead to
// different places — a build that sent both to a fresh run reads `playing` here.
//
// BOTH END SCREENS, BECAUSE A BUILD COMMONLY WIRES ONE. The victory and game-over
// screens are reached by different paths and are often built separately, so a menu
// that works on one and not the other is a real defect that reading only one screen
// would hide.
//
// THE SCREENS ARE POSED, NOT REACHED. `setScreen` sets the field alone and runs no
// entry effect (`specs/instrumentation.md`), which is exactly what this item wants:
// where a row leads is not an entry effect, and reaching victory or a game over
// through the run's own transitions would make this verdict depend on the wave
// rules — those are `waves.victory-on-clearing-the-final-wave`'s and
// `waves.game-over-at-zero-lives`'s. What each screen must be showing when it opens
// IS an entry effect, and that is `screens.play-again-focused`'s.
//
// THE RUN BEHIND THE MENU IS LEFT WHERE THE HARNESS PUT IT, because nothing about
// this row depends on it: the reading is the screen the press leads to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS, type Screen } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  tapAction,
  type Harness,
} from "../harness";

/** The row confirmed: `MENU`, the second of the two `ENDING_ITEMS`. */
const MENU_ROW = ENDING_ITEMS.length - 1;

/** The two screens the row appears on (`specs/screens.md`). */
const END_SCREENS: readonly Screen[] = ["victory", "gameover"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("returns to the title when MENU is confirmed on either end screen", async () => {
  const { debug } = h;
  for (const screen of END_SCREENS) {
    const where = `${ENDING_ITEMS[MENU_ROW]}, row ${MENU_ROW} of ${ENDING_ITEMS.length} on ${screen}`;

    await startRun(h);
    await debug.setScreen(screen);
    await debug.setMenuIndex(MENU_ROW);
    await h.advance(1);

    const posed = await h.snapshot();
    assertEqual(posed.screen, screen, `the screen the scenario is posed on, for ${where}`);
    assertEqual(posed.menuIndex, MENU_ROW, `the row posed for ${where}`);

    await tapAction(h, "confirm");
    await h.advance(1);
    await captureStill(h, "title");

    const after = await h.snapshot();
    assertEqual(after.screen, "title", `the screen confirming ${where} leads to`);
  }
});
