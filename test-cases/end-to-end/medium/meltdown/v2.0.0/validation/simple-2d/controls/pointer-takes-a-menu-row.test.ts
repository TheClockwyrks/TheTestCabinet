// controls/pointer-takes-a-menu-row — a press and release inside a menu row's
// rectangle highlights that row and takes it.
//
// THE RULE. `specs/controls.md`'s pointer table: a press and release landing on "a
// row of the menu the current screen shows" makes "that row ... the highlighted
// row and is taken, exactly as `confirm` on it does". Its Touch section says the
// same of a finger: "A tap on a menu row both highlights that row and takes it, so
// the menu a mouse reaches by hovering and confirming is reached by one contact,
// and every screen is left by tapping a row rather than by pressing a key."
//
// HOW "HIGHLIGHTS AND TAKES" IS READ AS ONE THING. Both halves resolve in one
// interaction, so the highlight cannot be read between them — but the row that is
// TAKEN says which row was highlighted. Each leg poses the highlight on a
// DIFFERENT row from the one pressed, and the two rows lead to different screens:
// a build that pressed the row under the pointer lands on one screen, and a build
// that merely confirmed whatever was already highlighted lands on the other.
//
//   THE TITLE. Posed on `HOW TO PLAY`, pressed on `PLAY`: a build that took the
//   posed row opens `howto` where `modeselect` is due.
//
//   THE MODE LIST. Posed on the second row, which starts a run outright, pressed
//   on `CONTAINMENT`: a build that took the posed row opens `playing` where
//   `difficultyselect` is due.
//
// TWO SCREENS, BECAUSE ONE OF THEM WOULD NOT SAY IT. The rule is stated of "the
// menu the current screen shows" rather than of one menu, and a build that wired
// the title's rows by hand and left every other screen to the keyboard passes a
// single-screen reading. Both legs exercise the same requirement the same way, so
// they share one verdict.
//
// THE POINTER IS DRIVEN AT THE RECTANGLE THE BUILD REPORTED, which is what makes
// this decidable at all: `specs/screens.md` leaves the layout of a menu entirely
// to the build and has it report each row's rectangle. That the rectangles are
// reported is `screens.menu-rows-reported`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { MODE_ITEMS, TITLE_ITEMS } from "../constants";
import {
  captureStill,
  clickMenuRow,
  createHarness,
  type Harness,
} from "../harness";

/** The title's two rows: the one pressed, and the one the highlight is posed on. */
const TITLE_PLAY_ROW = TITLE_ITEMS.indexOf("PLAY");
const TITLE_HOWTO_ROW = TITLE_ITEMS.indexOf("HOW TO PLAY");

/**
 * The mode list's rows: the one pressed, and the one the highlight is posed on.
 *
 * The posed row is the second, `THE HUNDRED`, which `specs/screens.md` sends
 * straight to `playing` — a different screen from the one `CONTAINMENT` opens, so
 * the two cannot be confused.
 */
const MODE_CONTAINMENT_ROW = MODE_ITEMS.indexOf("CONTAINMENT");
const MODE_SECOND_ROW = MODE_CONTAINMENT_ROW + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the row a press and release land inside", async () => {
  h.debug.reset();
  h.debug.setScreen("title");
  h.debug.setMenuIndex(TITLE_HOWTO_ROW);
  await h.advance(1);
  const posedTitle = h.snapshot();
  assertEqual(posedTitle.screen, "title", "the screen the press is made on");
  assertEqual(
    posedTitle.menuIndex,
    TITLE_HOWTO_ROW,
    "the row the highlight is posed on, which is NOT the row pressed",
  );

  await clickMenuRow(h, TITLE_PLAY_ROW);
  captureStill(h, "taken");
  const afterTitle = h.snapshot();
  assertEqual(
    afterTitle.screen,
    "modeselect",
    `the screen a press inside row ${TITLE_PLAY_ROW} of the title menu ` +
      `leads to; a build that took the highlighted row instead reads howto ` +
      `(specs/controls.md, specs/screens.md)`,
  );

  h.debug.reset();
  h.debug.setScreen("modeselect");
  h.debug.setMenuIndex(MODE_SECOND_ROW);
  await h.advance(1);
  const posedModeselect = h.snapshot();
  assertEqual(
    posedModeselect.screen,
    "modeselect",
    "the screen the press is made on",
  );
  assertEqual(
    posedModeselect.menuIndex,
    MODE_SECOND_ROW,
    "the row the highlight is posed on, which is NOT the row pressed",
  );

  await clickMenuRow(h, MODE_CONTAINMENT_ROW);
  const afterModeselect = h.snapshot();
  assertEqual(
    afterModeselect.screen,
    "difficultyselect",
    `the screen a press inside row ${MODE_CONTAINMENT_ROW} of the mode menu ` +
      `leads to; a build that took the highlighted row instead reads playing ` +
      `(specs/controls.md, specs/screens.md)`,
  );
});
