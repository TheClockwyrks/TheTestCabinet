// screens/game-over-menu-returns-to-the-title — MENU leaves the game-over screen
// for the title.
//
// `specs/ui.md` gives the game-over menu's second entry, `MENU`, one effect: it
// "Returns to `title`, with the title's highlight at the first entry." What this
// point decides is the route — the screen the game lands on.
//
// THE ENTRY IS POSED, NOT WALKED TO. `setMenuIndex(1)` puts the highlight on
// `MENU` outright (`specs/instrumentation.md`), so a build with a broken menu
// key loses `controls/menu-*` rather than this point as well.
//
// THE ENTRY IS CONFIRMED THROUGH THE REGISTERED ACTION, because which key
// confirms is `controls/confirm-enter`'s and `controls/confirm-space`'s.
//
// AND THE TITLE IS THE PRESS'S DOING. A quarter second runs on the game-over
// screen with nothing down and the screen is read at the end of it, so a build
// whose game-over screen falls back to its title on a timer — the arcade
// attract-mode habit — is caught there rather than passing here.
//
// THE RUN THAT ENDED IS POSED ONTO THE SCREEN, so the screen is the one a
// finished game actually leaves: its score, and the `0` ships that ended it.
// Nothing below reads either figure; they are there so the press is taken on the
// screen the point is about rather than on a game-over screen posed over a fresh
// run.
//
// WHAT THIS DOES NOT DECIDE. What the game-over screen shows
// (`screens/game-over-shows-the-score`, `screens/game-over-shows-the-wave`), how
// it is reached (`screens/game-over-on-the-last-life`), the other entry
// (`screens/play-again-starts-a-game`), and what the title then draws
// (`screens/title-*`).

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entry the highlight is posed on: `MENU`, the second. */
const MENU = 1;

/** The score the finished run ended on. */
const FINAL_SCORE = 4321;

/** The ships a finished run has left: none (specs/progression.md). */
const FINAL_LIVES = 0;

/** The quiet stretch driven on the game-over screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when MENU is confirmed on the gameover screen", async () => {
  // The game-over screen a finished run leaves, with the highlight on MENU.
  resetTo(h);
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(MENU);
  h.debug.setScore(FINAL_SCORE);
  h.debug.setLives(FINAL_LIVES);

  await h.advance(QUIET_TICKS);
  const before = h.snapshot();

  await tapAction(h, "confirm");
  const after = h.snapshot().screen;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "title");

  assertEqual(
    before.screen,
    "gameover",
    `the screen after ${String(QUIET_TICKS)} ticks on the game-over screen ` +
      "with no key down — it is left on a confirmed entry (specs/ui.md)",
  );
  assertEqual(
    before.menuIndex,
    MENU,
    "the highlighted entry the press was taken on, posed through " +
      "setMenuIndex (specs/instrumentation.md)",
  );
  assertEqual(
    after,
    "title",
    `the screen on the tick confirm was pressed with the game-over menu on ` +
      `entry ${String(MENU)} of ${String(GAMEOVER_ITEMS.length)}, ` +
      `${JSON.stringify(GAMEOVER_ITEMS[MENU])} — that entry returns to title ` +
      "(specs/ui.md)",
  );
});
