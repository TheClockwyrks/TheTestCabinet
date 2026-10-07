// Spectra — pointer/game-over-hover-selects: moving the mouse onto a
// game-over-menu item selects it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": the three menu screens,
// "`title`, `paused`, and `gameOver`, are driven by a mouse and by touch as
// well as by the keyboard, over the items that screen shows", and "A pointer
// moves onto an item's region" makes `menuIndex` that item's index. This point
// decides that on the GAME-OVER screen; `pointer/title-hover-selects` and
// `pointer/pause-hover-selects` decide it on the other two.
//
// HOW THE SCREEN IS REACHED. `poseGameOverMenu` PLACES a lost run — the stage
// it reached, the score it ended on, no lives left — and places the screen and
// the highlight with it: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so no life is spent on
// the way in, and neither the death path nor the menu keys can fail this point.
// The pose leaves `PLAY AGAIN`, the first entry, highlighted, and the copy at
// the index driven is held against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. The pointer alone, onto `MENU`'s region — the second entry,
// not the one the pose highlights, so the index read back can have come from
// nowhere but the mouse. NO BUTTON IS PRESSED, and `screen` is read back beside
// the index: a move alone selects and confirms nothing.
//
// EVERY WRONG MODEL READS AS A DIFFERENT STATE. A build that reads no pointer
// on the game-over screen is still on `gameOver` with `menuIndex` at `0`, and
// fails on the index; a build that fires the entry it moved onto has left
// `gameOver` for `title`; one that fires the already-highlighted `PLAY AGAIN`
// on the move has left it for `stageIntro`. Only a build that selects on the
// move alone is on `gameOver` with the highlight on `MENU`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and the pointer is moved to the
// middle of it, so any layout passes and a build that reports a region it does
// not answer on fails.
//
// WHAT IS NOT ASSERTED. Where the title's highlight rests when `MENU` is taken,
// which is `screens/game-over-menu-returns`'s — nothing is confirmed here, so
// the title is never reached. Nor what the game-over screen reports about the
// run, which is `screens/game-over-reports-run`'s; nor what it draws, which is
// `screens/game-over-menu-items`'s; nor that the keyboard `confirm` reaches
// these entries, which is `screens/game-over-play-again`'s and
// `screens/game-over-menu-returns`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAME_OVER_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pointerOntoItem,
  poseGameOverMenu,
  type Harness,
} from "../harness";

/**
 * The game-over menu's entries, by index, and the copy at the one driven.
 *
 * `specs/ui.md` fixes `GAME_OVER_ITEMS` as "`PLAY AGAIN`, then `MENU`", so `PLAY
 * AGAIN` is `0` and `MENU` is `1`. The order and the copy are the specification's;
 * the check reads them off the project's own `GAME_OVER_ITEMS` and holds the entry
 * it drives against the copy before driving it.
 */
const PLAY_AGAIN_INDEX = 0;
const MENU_INDEX = 1;
const MENU_ITEM = "MENU";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("selects the game-over-menu item the pointer moves onto", async () => {
  await poseGameOverMenu(h, PLAY_AGAIN_INDEX);

  assertEqual(
    GAME_OVER_ITEMS[MENU_INDEX],
    MENU_ITEM,
    "the second GAME_OVER_ITEMS entry is MENU (specs/ui.md)",
  );
  const posed = h.snapshot();
  assertEqual(posed.screen, "gameOver", "the game is on the game-over screen");
  assertEqual(
    posed.menuIndex,
    PLAY_AGAIN_INDEX,
    "with PLAY AGAIN, its first entry, highlighted before the gesture",
  );

  await pointerOntoItem(h, MENU_INDEX);
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(
    hovered.menuIndex,
    MENU_INDEX,
    `menuIndex after the pointer moved onto ${MENU_ITEM}'s own region ` +
      "(specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    hovered.screen,
    "gameOver",
    "the screen a move alone reaches: a hover selects and confirms nothing " +
      "(specs/ui.md)",
  );
});
