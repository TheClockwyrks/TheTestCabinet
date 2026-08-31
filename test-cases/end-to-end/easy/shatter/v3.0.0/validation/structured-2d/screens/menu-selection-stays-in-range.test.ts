// screens/menu-selection-stays-in-range — a menu's selection never leaves that
// menu's own entries.
//
// `specs/controls.md`, on menus: "The up and down inputs move the highlight by
// one entry and wrap at both ends, so moving down from the last entry highlights
// the first and moving up from the first highlights the last. The highlight is
// therefore always on one of the menu's own entries." That last sentence is this
// point: whatever a player does with the two move inputs, `menuIndex` names an
// entry the menu actually has.
//
// TEN MOVES IN EACH DIRECTION, ON EVERY MENU THE GAME SHOWS. Ten is five times
// round the two-entry menus and more than three times round the three-entry one,
// so a build that clamps at an end, one that runs its index off the top, and one
// that lets it go negative are each driven well past the end they mishandle. The
// three menus `specs/ui.md` states are all driven, because the entry COUNT is
// what the wrap is taken modulo and a build that wrapped a two-entry menu
// correctly can still run a three-entry one off its end.
//
// EVERY READING IS TAKEN, NOT JUST THE LAST. The index is read after each of the
// twenty presses, so a build whose index leaves the entries and comes back —
// which a final reading alone would pass — fails naming the press it left on.
//
// AN ENTRY IS A WHOLE NUMBER. `specs/instrumentation.md` reports `menuIndex` as
// "the highlighted entry, from 0", so a fractional index names no entry however
// close to one it sits, and that is asserted beside the range.
//
// WHERE THE HIGHLIGHT LANDS IS NOT THIS POINT. `controls/menu-*` decides that a
// move goes one entry in the right direction; this decides only that it never
// leaves the menu. So nothing here asserts a particular index, and a build that
// wraps the wrong way still passes here and fails there.
//
// THE MENUS ARE POSED DIRECTLY, and the paused one over the empty, quiet field
// `startPlaying` leaves, so nothing behind a menu can reach the highlight while
// the presses are driven.
//
// WHAT THIS DOES NOT DECIDE. Which key moves a menu, and which way
// (`controls/menu-up-arrow`, `controls/menu-down-arrow`, `controls/menu-w`,
// `controls/menu-s`), what each menu shows (`screens/*-menu-entries`), and where
// a confirmed entry leads (`screens/*`).

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  tapAction,
  type Action,
  type Harness,
} from "../harness";
import type { Screen } from "../surface";

/**
 * How many times each direction is driven.
 *
 * Ten: five times round the two-entry menus and more than three times round the
 * three-entry one, so every menu is carried past both of its ends several times
 * over rather than just to them.
 */
const MOVES = 10;

/** The two menu inputs, in the order they are driven. */
const DIRECTIONS: readonly Action[] = ["down", "up"];

/** One menu the game shows, and how the game is posed onto it. */
interface Menu {
  screen: Screen;
  items: readonly string[];
  pose: (h: Harness) => void;
}

/**
 * Every menu `specs/ui.md` states, with the paused one last so the still shows
 * the three-entry menu — the one with an interior entry to hold a selection on.
 */
const MENUS: readonly Menu[] = [
  {
    screen: "title",
    items: TITLE_ITEMS,
    pose: (h) => {
      resetTo(h);
    },
  },
  {
    screen: "gameover",
    items: GAMEOVER_ITEMS,
    pose: (h) => {
      resetTo(h);
      h.debug.setScreen("gameover");
    },
  },
  {
    screen: "paused",
    items: PAUSE_ITEMS,
    pose: (h) => {
      startPlaying(h);
      h.debug.setScreen("paused");
    },
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps menuIndex on one of the menu's own entries through ten moves each way, on every menu", async () => {
  for (const menu of MENUS) {
    menu.pose(h);
    h.debug.setMenuIndex(0);

    const last = menu.items.length - 1;
    const where = `the ${menu.screen} menu's ${String(menu.items.length)} entries`;

    assertEqual(
      h.snapshot().screen,
      menu.screen,
      `the screen the menu was posed on, through setScreen ` +
        "(specs/instrumentation.md)",
    );

    for (const direction of DIRECTIONS) {
      for (let move = 1; move <= MOVES; move += 1) {
        await tapAction(h, direction);
        const index = h.snapshot().menuIndex;
        const press = `after press ${String(move)} of ${String(MOVES)} of the ${direction} input on ${where}`;

        assertEqual(
          Math.trunc(index),
          index,
          `menuIndex a whole number ${press} — it is the highlighted entry, ` +
            "counted from 0 (specs/instrumentation.md)",
        );
        assertBetween(
          index,
          0,
          last,
          `menuIndex ${press} — the up and down inputs wrap at both ends, so ` +
            "the highlight is always on one of the menu's own entries " +
            "(specs/controls.md)",
        );
      }
    }
  }

  captureStill(h, "menu");
});
