// Spectra — pointer/game-over-click-confirms: a press and release inside one
// game-over-menu item takes it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": the three menu screens,
// "`title`, `paused`, and `gameOver`, are driven by a mouse and by touch as
// well as by the keyboard, over the items that screen shows", and "A pointer is
// pressed and released inside one item's region" makes `menuIndex` that item's
// index "and that item is confirmed", with "the effect the screen's own table
// above gives that item" — on the game-over screen, `MENU` "Returns to
// `title`".
//
// HOW THE SCREEN IS REACHED. `poseGameOverMenu` PLACES a lost run — the stage
// it reached, the score it ended on, no lives left — and places the screen and
// the highlight with it: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so no life is spent on
// the way in, and neither the death path nor the menu keys can fail this point.
// The pose leaves `PLAY AGAIN`, the first entry, highlighted, and the copy at
// the index driven is held against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. The mouse alone: a press and its release, both inside the
// region the build reports for `MENU`. The pose highlights `PLAY AGAIN`, so the
// entry the gesture confirmed is the one the screen that follows names. NO KEY
// IS PRESSED, so a build whose keyboard `confirm` is broken still has its
// pointer graded here.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that reads no pointer
// on this screen is still on `gameOver`; one that confirms the
// already-highlighted `PLAY AGAIN` opens a fresh run and reaches `stageIntro`;
// and only the specified route — a press and its release inside `MENU`'s own
// region — reaches `title`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and the press and its release
// both land in the middle of it, so any layout passes and a build that reports
// a region it does not answer on fails.
//
// WHAT IS NOT ASSERTED. Where the title's highlight rests on arriving, which is
// `screens/game-over-menu-returns`'s: this point reads `screen` alone, so a
// build that arrives with the wrong entry highlighted passes here and fails
// there. Nor what the game-over screen reports about the run, which is
// `screens/game-over-reports-run`'s; nor what it draws, which is
// `screens/game-over-menu-items`'s; nor that the keyboard `confirm` reaches
// these entries, which is `screens/game-over-play-again`'s and
// `screens/game-over-menu-returns`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GAME_OVER_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
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

afterEach(async () => {
  await h.dispose();
});

it("confirms the game-over-menu item a press and release fall inside", async () => {
  await poseGameOverMenu(h, PLAY_AGAIN_INDEX);

  assertEqual(
    GAME_OVER_ITEMS[MENU_INDEX],
    MENU_ITEM,
    "the second GAME_OVER_ITEMS entry is MENU (specs/ui.md)",
  );
  const posed = await h.snapshot();
  assertEqual(posed.screen, "gameOver", "the game is on the game-over screen");
  assertEqual(
    posed.menuIndex,
    PLAY_AGAIN_INDEX,
    "with PLAY AGAIN, its first entry, highlighted before the gesture",
  );

  await clickItem(h, MENU_INDEX);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    `the screen a press and release inside ${MENU_ITEM}'s own region reaches ` +
      "(specs/ui.md, Pointer and touch)",
  );
});
