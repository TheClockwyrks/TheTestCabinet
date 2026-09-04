// Spectra — pointer/pause-click-confirms: a press and release inside one pause-menu
// item takes it.
//
// THE RULE. `specs/ui.md`, "Pointer and touch": the three menu screens, "`title`,
// `paused`, and `gameOver`, are driven by a mouse and by touch as well as by the
// keyboard, over the items that screen shows", and "A pointer is pressed and
// released inside one item's region" makes `menuIndex` that item's index "and that
// item is confirmed", with "the effect the screen's own table above gives that
// item" — on the paused screen, `QUIT TO MENU` "Returns to `title`".
//
// HOW THE SCREEN IS REACHED. `posePausedMenu` opens a live wave and then PLACES the
// screen and the highlight: `setScreen` and `setMenuIndex` are what
// `specs/instrumentation.md` provides for posing them, so the `pause` key is never
// pressed on the way in and the menu keys cannot fail this point. The pose leaves
// `RESUME`, the first entry, highlighted, and the copy at the index driven is held
// against `specs/ui.md`'s own before the gesture.
//
// WHAT IS DRIVEN. The mouse alone: a press and its release, both inside the region
// the build reports for `QUIT TO MENU`. The pose highlights `RESUME`, so the entry
// the gesture confirmed is the one the screen that follows names. NO KEY IS PRESSED,
// so a build whose keyboard `confirm` is broken still has its pointer graded here.
//
// EVERY WRONG MODEL READS AS A DIFFERENT SCREEN. A build that reads no pointer on
// this screen is still on `paused`; one that confirms the already-highlighted
// `RESUME` reaches `inWave`; one that confirms `RESTART` reaches `stageIntro`; and
// only the specified route — a press and its release inside `QUIT TO MENU`'s own
// region — reaches `title`.
//
// WHERE THE ITEMS ARE, IS THE BUILD'S: the region comes from the build's own
// `menuItemRect` (`specs/instrumentation.md`) and both edges land in the middle of
// it, so any layout passes.
//
// WHAT IS NOT ASSERTED. Anything about audio: `specs/ui.md`'s `paused` section
// says the frozen field plays no cue, while its cue table lists a `menu` cue
// for a moved highlight, and that tension is pre-existing — no point here
// depends on how it resolves. Nor where the title's highlight rests on
// arriving, which is `screens/game-over-menu-returns`'s and
// `screens/howto-returns-selection`'s; nor what the paused screen draws, which
// is `screens/pause-menu-items`'s; nor that the keyboard `confirm` reaches
// these entries, which is `screens/pause-quit`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  clickItem,
  createHarness,
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

afterEach(async () => {
  await h.dispose();
});

it("confirms the pause-menu item a press and release fall inside", async () => {
  await posePausedMenu(h, RESUME_INDEX);

  assertEqual(
    PAUSE_ITEMS[QUIT_INDEX],
    QUIT_ITEM,
    "the third PAUSE_ITEMS entry is QUIT TO MENU (specs/ui.md)",
  );
  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the game is on the paused screen");
  assertEqual(
    posed.menuIndex,
    RESUME_INDEX,
    "with RESUME, its first entry, highlighted before the gesture",
  );

  await clickItem(h, QUIT_INDEX);
  await captureStill(h, "title");

  assertEqual(
    (await h.snapshot()).screen,
    "title",
    `the screen a press and release inside ${QUIT_ITEM}'s own region reaches ` +
      "(specs/ui.md, Pointer and touch)",
  );
});
