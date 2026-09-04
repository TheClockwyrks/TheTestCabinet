// Meltdown — screens/menu-rows-reported — every menu screen reports one hit rectangle
// per row, in row order.
//
// THE RULE. `specs/screens.md`, Menus: "Where a build draws a menu is its own
// choice, so the game reports each row's hit rectangle as `menu` in the snapshot
// `specs/instrumentation.md` defines, in row order."
// `specs/instrumentation.md` says the same of the field: `menu` holds "every row
// of the menu the current screen shows ... in the row order `specs/screens.md`
// gives that menu and with `index` matching the row number `menuIndex` counts",
// and it is "empty while the screen is `playing`".
//
// WHY A BUILD OWES THIS AT ALL. `specs/controls.md` makes every menu row a pointer
// target and the whole game playable on a touchscreen, and where a build put its
// rows is the build's own choice — so without this read no scenario could press
// one, and the pointer half of every menu would be unreachable. The read is the
// menus' counterpart of the `controls` read the build panel already owes.
//
// ALL SEVEN MENU SCREENS, because the rule is stated of every menu in the game and
// a build that reports the title's rows and forgets the pause menu's leaves a
// paused player unable to touch anything. The failure names the screen.
//
// AND `playing`, WHICH MUST REPORT NONE, because a build that reported the last
// menu's rectangles over live play would have a scenario pressing a menu row that
// is not on screen.
//
// WHAT THIS DOES NOT DECIDE. That the rectangles are big enough to tap and do not
// overlap is `screens.menu-rows-are-touch-targets`'s, and that a press inside one
// takes the row is `controls.pointer-takes-a-menu-row`'s. This one reads that they
// are reported, one per row, in order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  HOWTO_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startRun,
  type Harness,
  type Screen,
} from "../harness";

/**
 * The seven screens that show a menu, and the rows `specs/screens.md` gives each,
 * top to bottom.
 *
 * `playing` is the eighth screen and the one with no menu, so it is read below on
 * its own: `specs/instrumentation.md` leaves `menu` empty there.
 */
const MENUS: readonly { screen: Screen; items: readonly string[] }[] = [
  { screen: "title", items: TITLE_ITEMS },
  { screen: "modeselect", items: MODE_ITEMS },
  { screen: "difficultyselect", items: DIFFICULTY_ITEMS },
  { screen: "howto", items: HOWTO_ITEMS },
  { screen: "paused", items: PAUSE_ITEMS },
  { screen: "victory", items: ENDING_ITEMS },
  { screen: "gameover", items: ENDING_ITEMS },
];

/** The screens a menu is drawn over a live run on, which have to be opened as one. */
const OVER_A_RUN: readonly Screen[] = [
  "playing",
  "paused",
  "victory",
  "gameover",
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** Pose one screen with its highlight on `index`, and run the frame that draws it. */
async function open(screen: Screen, index = 0): Promise<void> {
  if (OVER_A_RUN.includes(screen)) startRun(h);
  else resetTo(h);
  h.debug.setScreen(screen);
  h.debug.setMenuIndex(index);
  await h.advance(1);
}

it("reports one rectangle per row of every menu, in row order", async () => {
  for (const { screen, items } of MENUS) {
    await open(screen);
    const rows = h.snapshot().menu;
    if (screen === "modeselect") captureStill(h, "rows");

    assertEqual(
      rows.length,
      items.length,
      `the rectangles ${screen} reports for its ${items.length} rows ` +
        `(specs/screens.md, Menus)`,
    );
    for (let row = 0; row < items.length; row += 1) {
      assertEqual(
        rows[row]?.index,
        row,
        `the index of entry ${row} of ${screen}'s reported menu, which ` +
          `specs/instrumentation.md matches to the row number menuIndex ` +
          `counts, in row order`,
      );
    }
  }

  await open("playing");
  assertEqual(
    h.snapshot().menu.length,
    0,
    "the rectangles the playing screen reports, which shows no menu " +
      "(specs/instrumentation.md)",
  );
});
