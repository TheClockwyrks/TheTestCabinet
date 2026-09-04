// Floe — touch/ending-tap-confirms:
// a contact that lifts where it landed confirms that item, on an end screen.
//
// `specs/ui.md` gives ALL FOUR of this game's menus a finger — "All four menus
// are driven this way: `TITLE_ITEMS` on `title`, `PAUSE_ITEMS` on `paused`, and
// `ENDING_ITEMS` on `victory` and on `gameover`" — so a build that answers a
// contact on the title screen alone has honoured one of four. This point is the
// end screen, read for the contact's confirm.
//
// THE TITLE'S OWN COPY IS `touch/tap-confirms`, and the two fail independently
// for the reason `touch/ending-landing-selects` gives.
//
// THE ENTRY IS `MENU`, because what it does is loud: `specs/ui.md` has it return
// to `title`, while the entry beside it starts a fresh run and opens `playing`.
// A confirm that did not happen, and one that reached the wrong entry, are told
// apart from the right one by a single reading.
//
// WHAT IS NOT GRADED HERE. What confirming `MENU` does, including the entry it
// leaves selected on the title, is `screens.gameover-menu`. This point is that a
// contact landing and lifting inside the region confirmed it at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENDING_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  menuRect,
  rectCenter,
  touchPress,
  touchRelease,
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

it("confirms the end-screen item a contact lands and lifts inside", async () => {
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
  await touchRelease(h);
  captureStill(h, "title");

  assertEqual(
    h.snapshot().screen,
    "title",
    `a contact landing and lifting inside ${ENDING_ITEMS[MENU_ITEM]}'s region ` +
      "confirms it, and confirming it returns to the title (specs/ui.md)",
  );
});
