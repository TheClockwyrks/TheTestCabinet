// screens/game-over-menu-returns-to-the-title — MENU leaves the game-over screen
// for the title.
//
// THE RULE. `specs/ui.md` gives the game-over menu's second entry,
// `GAMEOVER_ITEMS[1]` (`MENU`), one job: "returns to `title`".
// `specs/instrumentation.md` reports which of the five screens is showing as
// `screen`, so the reading is that field after the entry is taken. Without it a
// finished game has one way out, and a player who wants the instructions or a
// clean start has to reload the page.
//
// WHY THE SECOND ENTRY. The two game-over entries lead to two different screens,
// so posing the highlight on the second is what separates a build that reads the
// highlight from one whose confirm is wired to the first entry: that build lands
// on `playing` rather than `title`, and the failure names the screen it reached.
//
// THE ENTRY IS ADDRESSED BY ITS INDEX. `specs/ui.md` fixes the ORDER of the
// game-over entries but says nothing about which one the screen OPENS on, so the
// highlight is posed with `setMenuIndex` rather than driven there with a count of
// key presses; the entry's own copy is asserted first, so a build that reordered
// its menu fails naming what it put second. The confirm itself is a real press of
// a key `specs/controls.md` binds.
//
// WHAT THIS ITEM DOES NOT DECIDE. The title screen's own contents, which are
// `screens/title-shows-the-title` and `screens/title-menu-entries`, nor how the
// game reached the game-over screen, which is
// `screens/game-over-on-the-last-life`. `specs/ui.md` also puts the title's
// highlight back on its first entry after the return; the manifest's item is the
// screen alone, so that is left ungraded here rather than folded into this grade.

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import { captureStill, createHarness, keyFor, type Harness } from "../harness";

/** The entry `specs/ui.md` fixes as the game-over menu's second. */
const MENU = 1;

/** The run the game-over screen carries: a score, no ships, a wave reached. */
const POSED_SCORE = 4260;
const POSED_WAVE = 13;
const NO_SHIPS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when MENU is confirmed on the game-over screen", async () => {
  assertEqual(
    GAMEOVER_ITEMS[MENU],
    "MENU",
    "the second entry of the game-over menu specs/ui.md fixes",
  );

  h.debug.reset();
  h.debug.setScreen("gameover");
  h.debug.setScore(POSED_SCORE);
  h.debug.setWave(POSED_WAVE);
  h.debug.setLives(NO_SHIPS);
  h.debug.setMenuIndex(MENU);

  const over = h.snapshot();
  assertEqual(over.screen, "gameover", "the screen the entry was taken from");
  assertEqual(over.menuIndex, MENU, "the entry the highlight was posed on");

  await h.tap(keyFor("confirm"));
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen confirming MENU returns to (specs/ui.md)",
  );
});
