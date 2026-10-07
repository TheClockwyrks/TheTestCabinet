// Floe — touch/ending-landing-selects:
// a touch contact selects the item it lands on, on an end screen.
//
// `specs/ui.md` gives ALL FOUR of this game's menus a finger — "All four menus
// are driven this way: `TITLE_ITEMS` on `title`, `PAUSE_ITEMS` on `paused`, and
// `ENDING_ITEMS` on `victory` and on `gameover`" — so a build that answers a
// contact on the title screen alone has honoured one of four. This point is the
// end screen, read for the first of the contact's three effects.
//
// THE TITLE'S OWN COPY IS `touch/landing-selects`. The two fail independently: an
// end screen carries a different menu, reached at the end of a run rather than
// before one, so a build that hit-tests the title's regions and not the ending's
// is caught here rather than there.
//
// THE CONTACT IS LEFT DOWN, so no lift can confirm and the reading is the
// selection alone. `touch/ending-tap-confirms` is the point that adds the lift.
//
// WHAT IS NOT GRADED HERE. What the game-over screen shows is
// `screens.gameover-screen`; what confirming `MENU` does is
// `screens.gameover-menu`. This point is the contact's own effect on this menu.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  rectCenter,
  touchPress,
  type Harness,
} from "../harness";

/** The entry the pose highlights: `PLAY AGAIN`, the first of the two. */
const PLAY_AGAIN_ITEM = 0;

/** The entry the contact aims at: `MENU`, the second. */
const MENU_ITEM = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("selects the end-screen item a contact lands on", async () => {
  h.debug.reset();
  h.debug.setScreen("gameover");
  h.debug.setMenuIndex(PLAY_AGAIN_ITEM);

  const posed = h.snapshot();
  assertEqual(posed.screen, "gameover", "the pose opened the game-over screen");
  assertEqual(
    posed.menuIndex,
    PLAY_AGAIN_ITEM,
    `the pose highlighted ${ENDING_ITEMS[PLAY_AGAIN_ITEM]}, the first of the two`,
  );

  const target = rectCenter(menuRect(h, MENU_ITEM));
  await touchPress(h, target.x, target.y);
  captureStill(h, "selected");

  const after = h.snapshot();
  assertEqual(
    after.menuIndex,
    MENU_ITEM,
    `a contact landing inside ${ENDING_ITEMS[MENU_ITEM]}'s region selects it ` +
      "(specs/ui.md)",
  );
  assertEqual(
    after.screen,
    "gameover",
    "and selects it rather than confirming it: the contact has not lifted",
  );
});
