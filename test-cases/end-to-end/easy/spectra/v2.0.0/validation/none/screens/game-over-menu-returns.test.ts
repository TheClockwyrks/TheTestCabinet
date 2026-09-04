// Spectra — screens/game-over-menu-returns: MENU returns to the title.
//
// THE RULE. `specs/ui.md`, on the `gameOver` menu's second entry: "`MENU` Returns
// to `title`, with the title's highlight on the mode entry." This point decides
// the screen that entry reaches, and where the highlight rests on arriving.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A confirm wired to nothing
// leaves the game on `gameOver`; one that ignores the highlight and takes `PLAY
// AGAIN` reaches `stageIntro` on a fresh run; and only the route `specs/ui.md`
// states reaches `title`. That is what makes the second entry the right one to
// pose: the wrong entry and the wrong key each land somewhere else.
//
// THE HIGHLIGHT IS PLACED, NOT WALKED TO. `setMenuIndex` is what
// `specs/instrumentation.md` provides for posing the highlighted item of whatever
// menu the current screen shows, so the menu keys cannot fail this point. Which
// index `MENU` is, is read off `GAME_OVER_ITEMS`, whose order `specs/ui.md`
// fixes, and the entry at that index is held against the specification's own copy
// before the press.
//
// WHY THIS IS NOT `screens/pause-quit` AGAIN. They are two different entries on
// two different screens, and `specs/ui.md` states the rule separately for each. A
// build that wired one and not the other must grade differently from one that
// wired neither, which is only true if each has a point of its own.
//
// WHAT IS NOT ASSERTED. What a fresh run carries, which is
// `screens/game-over-play-again`'s; that `Enter` is one of `confirm`'s keys,
// which is `controls/confirm-enter`'s; what the game-over screen draws, which is
// `screens/game-over-menu-items`'.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, GAME_OVER_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** Which entry of `GAME_OVER_ITEMS` is confirmed, and the copy it must be. */
const MENU_INDEX = 1;
const MENU_ITEM = "MENU";

/** The lost run the entry is pressed from (specs/progression.md). */
const POSED_STAGE = 6;
const POSED_SCORE = 7250;
const POSED_LIVES = 0;

/** Where the title's highlight rests on arriving: the mode entry, its first. */
const TITLE_FIRST = 0;

/** The key `specs/controls.md` binds `confirm` to. */
const CONFIRM_KEY = BINDINGS.confirm[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the game to the title when MENU is confirmed", async () => {
  await h.debug.setScreen("gameOver");
  await h.debug.setStage(POSED_STAGE);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setMenuIndex(MENU_INDEX);
  await h.advance(1);

  assertEqual(
    GAME_OVER_ITEMS[MENU_INDEX],
    MENU_ITEM,
    "the second GAME_OVER_ITEMS entry is MENU (specs/ui.md)",
  );
  const before = await h.snapshot();
  assertEqual(before.screen, "gameOver", "the game is on the game-over screen");
  assertEqual(
    before.menuIndex,
    MENU_INDEX,
    "with MENU highlighted before the press",
  );

  await h.tap(CONFIRM_KEY);
  await captureStill(h, "title");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    `confirming the highlighted ${MENU_ITEM} entry returning the game to the ` +
      "title screen (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    TITLE_FIRST,
    "with the title's highlight on the mode entry, its first (specs/ui.md)",
  );
});
