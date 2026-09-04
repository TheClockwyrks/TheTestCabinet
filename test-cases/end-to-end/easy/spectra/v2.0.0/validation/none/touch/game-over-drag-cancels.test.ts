// Spectra — touch/game-over-drag-cancels: a contact that lifts elsewhere on the
// game-over menu takes nothing.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": "A confirm takes both of its
// edges inside one item's region: ... the landing and the lift for a touch
// contact. Two edges that fall in different regions ... confirm no item." It
// holds over the items each of the three menu screens shows, and this point
// decides it on the GAME-OVER screen: whether THIS screen pairs the two edges
// is a thing a build decides for itself.
//
// HOW THE SCREEN IS REACHED. `poseGameOverMenu` PLACES a lost run — the stage
// it reached, the score it ended on, no lives left — and places the screen and
// the highlight with it: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so no life is spent on
// the way in, and neither the death path nor the menu keys can fail this point.
// The pose leaves `PLAY AGAIN`, the first entry, highlighted, and the copy at
// the index driven is held against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. One contact lands inside `PLAY AGAIN`'s region — the entry
// the pose already highlights — travels onto `MENU`'s region while held, and
// lifts there. Nothing is confirmed, and the selection followed the finger, so
// the highlight is on `MENU`, the item the contact ended over — the travel rule
// `specs/ui.md` states in the same table.
//
// WHY THE CONTACT LANDS ON THE HIGHLIGHTED ITEM. A cancel is a negative claim,
// and a build that reads no touch on this screen satisfies a negative claim for
// free: leave the gesture ending where the pose already put the highlight and
// both readings come out right for a build with no touch code in it. Landing on
// the entry the highlight is ALREADY on and lifting on another makes this point
// read back a highlight that MOVED, which is what makes the negative claim
// decidable rather than free.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that confirms on the
// landing edge confirms `PLAY AGAIN` and reaches `stageIntro`; a build that
// confirms on the lift edge alone confirms `MENU` and reaches `title`; a build
// that never saw the contact is on `gameOver` with `menuIndex` still `0`, and
// fails on the highlight. Only a build that requires BOTH edges in one region
// is on `gameOver` with the highlight on `MENU`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: both regions come from the build's own
// `menuItemRect` (`specs/instrumentation.md`), so any layout passes.
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
  poseGameOverMenu,
  touchBetweenItems,
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

it("confirms nothing when the contact lifts in another game-over-menu item", async () => {
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

  await touchBetweenItems(h, PLAY_AGAIN_INDEX, MENU_INDEX);
  await captureStill(h, "over");

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "gameOver",
    "the screen a contact landing in one item and lifting in another reaches: " +
      "neither is confirmed (specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    after.menuIndex,
    MENU_INDEX,
    `menuIndex after the held contact travelled onto ${MENU_ITEM}'s region, ` +
      "which selects it (specs/ui.md)",
  );
});
