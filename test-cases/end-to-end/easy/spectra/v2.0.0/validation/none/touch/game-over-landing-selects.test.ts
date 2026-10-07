// Spectra — touch/game-over-landing-selects: a contact selects the
// game-over-menu item it lands on.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": the three menu screens,
// "`title`, `paused`, and `gameOver`, are driven by a mouse and by touch as
// well as by the keyboard, over the items that screen shows", and "A touch
// contact lands inside an item's region, or travels onto one" makes `menuIndex`
// that item's index. A finger is not a small mouse — it never hovers — so the
// first the build hears of it is the LANDING, and the landing is what selects.
// This point decides that on the GAME-OVER screen;
// `touch/title-landing-selects` and `touch/pause-landing-selects` decide it on
// the other two.
//
// HOW THE SCREEN IS REACHED. `poseGameOverMenu` PLACES a lost run — the stage
// it reached, the score it ended on, no lives left — and places the screen and
// the highlight with it: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so no life is spent on
// the way in, and neither the death path nor the menu keys can fail this point.
// The pose leaves `PLAY AGAIN`, the first entry, highlighted, and the copy at
// the index driven is held against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. One touch contact, landing inside `MENU`'s region — the
// second entry, not the one the pose highlights, so the index read back can
// have come from nowhere but the finger. THE CONTACT IS LEFT DOWN, so no lift
// can confirm and the reading is the selection alone;
// `touch/game-over-tap-confirms` decides the confirm a lift makes.
//
// EVERY WRONG MODEL READS AS A DIFFERENT STATE. A build that reads no touch on
// the game-over screen is still on `gameOver` with `menuIndex` at `0`, and
// fails on the index; a build that confirms on the landing edge alone has left
// `gameOver` for `title`. Only a build that selects on the landing and waits
// for the lift is on `gameOver` with the highlight on `MENU`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and the contact lands in the
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
  landOnItem,
  liftContact,
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
  // The contact is left down by the check, so it is lifted before the page goes.
  await liftContact(h);
  await h.dispose();
});

it("selects the game-over-menu item a touch contact lands on", async () => {
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

  await landOnItem(h, MENU_INDEX);
  await captureStill(h, "selected");

  const landed = await h.snapshot();
  assertEqual(
    landed.menuIndex,
    MENU_INDEX,
    `menuIndex after a contact landed inside ${MENU_ITEM}'s own region ` +
      "(specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    landed.screen,
    "gameOver",
    "the screen a landing alone reaches: the contact has not lifted, so " +
      "nothing is confirmed (specs/ui.md)",
  );
});
