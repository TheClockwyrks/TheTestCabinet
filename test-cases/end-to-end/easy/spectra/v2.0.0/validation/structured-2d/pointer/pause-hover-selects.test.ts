// Spectra — pointer/pause-hover-selects: moving the mouse onto a pause-menu item
// selects it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": the three menu screens, "`title`,
// `paused`, and `gameOver`, are driven by a mouse and by touch as well as by the
// keyboard, over the items that screen shows", and "A pointer moves onto an item's
// region" makes `menuIndex` that item's index. This point decides that on the
// PAUSED screen; `pointer/title-hover-selects` decides it on the title.
//
// HOW THE SCREEN IS REACHED. `posePausedMenu` opens a live wave and then PLACES the
// screen and the highlight: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so the `pause` key is never
// pressed on the way in and the menu keys cannot fail this point. The pose leaves
// `RESUME`, the first entry, highlighted, and the copy at the index driven is held
// against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. The pointer alone, onto `QUIT TO MENU`'s region — the third entry,
// not the one the pose highlights, so the index read back can have come from nowhere
// but the mouse. NO BUTTON IS PRESSED, and `screen` is read back beside the index: a
// move alone selects and confirms nothing.
//
// EVERY WRONG MODEL READS AS A DIFFERENT STATE. A build that reads no pointer on the
// paused screen is still on `paused` with `menuIndex` at `0`, and fails on the
// index; a build that fires the entry it moved onto has left `paused` for `title`;
// one that fires the already-highlighted `RESUME` on the move has left it for
// `inWave`. Only a build that selects on the move alone is on `paused` with the
// highlight on `QUIT TO MENU`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and the pointer is moved to the middle
// of it, so any layout passes and a build that reports a region it does not answer
// on fails.
//
// WHAT IS NOT ASSERTED. Anything about audio: `specs/ui.md`'s `paused` section
// says the frozen field plays no cue, while its cue table lists a `menu` cue
// for a moved highlight, and that tension is pre-existing — no point here
// depends on how it resolves. Nor what the paused screen draws, which is
// `screens/pause-menu-items`'s; nor that the keyboard `confirm` reaches these
// entries, which is `screens/pause-quit`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  pointerOntoItem,
  posePausedMenu,
  type Harness,
} from "../harness";

/**
 * The pause menu's entries, by index, and the copy at the one driven.
 *
 * `specs/ui.md` fixes `PAUSE_ITEMS` as "`RESUME`, `RESTART`, `QUIT TO MENU`, in
 * that order", so `RESUME` is `0` and `QUIT TO MENU` is `2`. The order and the
 * copy are the specification's; the check reads them off the project's own
 * `PAUSE_ITEMS` and holds the entry it drives against the copy before driving it.
 */
const RESUME_INDEX = 0;
const QUIT_INDEX = 2;
const QUIT_ITEM = "QUIT TO MENU";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("selects the pause-menu item the pointer moves onto", async () => {
  await posePausedMenu(h, RESUME_INDEX);

  assertEqual(
    PAUSE_ITEMS[QUIT_INDEX],
    QUIT_ITEM,
    "the third PAUSE_ITEMS entry is QUIT TO MENU (specs/ui.md)",
  );
  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the game is on the paused screen");
  assertEqual(
    posed.menuIndex,
    RESUME_INDEX,
    "with RESUME, its first entry, highlighted before the gesture",
  );

  await pointerOntoItem(h, QUIT_INDEX);
  captureStill(h, "menu");

  const hovered = h.snapshot();
  assertEqual(
    hovered.menuIndex,
    QUIT_INDEX,
    `menuIndex after the pointer moved onto ${QUIT_ITEM}'s own region ` +
      "(specs/ui.md, Pointer and touch)",
  );
  assertEqual(
    hovered.screen,
    "paused",
    "the screen a move alone reaches: a hover selects and confirms nothing " +
      "(specs/ui.md)",
  );
});
