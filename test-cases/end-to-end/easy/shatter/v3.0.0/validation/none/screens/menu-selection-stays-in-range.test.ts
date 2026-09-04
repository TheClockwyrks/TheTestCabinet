// Shatter — screens/menu-selection-stays-in-range: a menu's highlight never leaves that
// menu's own entries.
//
// THE RULE. `specs/controls.md`, under Menus: "Every menu is vertical. The up and down
// inputs move the highlight by one entry and wrap at both ends, so moving down from the
// last entry highlights the first and moving up from the first highlights the last. The
// highlight is therefore always on one of the menu's own entries."
// `specs/instrumentation.md` reports the highlight as `menuIndex`, "the highlighted
// entry, from 0", so the rule reads as `0 <= menuIndex < entries` at every moment.
//
// TEN PRESSES IN EACH DIRECTION, ON ALL THREE MENUS. `specs/ui.md` gives the game three:
// two entries on the title, THREE on the pause menu, two on game over. Ten is more than
// any of them holds, so every menu is driven several times past both of its ends and the
// wrap is exercised in both directions; a build that clamps instead of wrapping is not
// caught here — it never leaves the range — and is caught by `screens/menu-wraps-up`
// and `screens/menu-wraps-down`, which is why the reading here is the RANGE rather than
// the sequence. Three menus rather than one because the entry count is what the
// bound is made of, and a build that hard-coded one menu's count into the other's move
// is caught only by driving both.
//
// EVERY PRESS IS CHECKED, NOT JUST THE LAST. "Throughout" is the item's own word: a build
// that runs to `3` on a two-entry menu and is folded back by the next press would pass a
// reading taken at the end alone, and it has already drawn a highlight on nothing.
//
// THE KEYS ARE REAL ONES. The move is what the specification defines as an INPUT, so it
// is driven as one, through Chromium's own input pipeline. What is posed is only the
// screen each menu belongs to and the entry the run starts from.
//
// WHAT THIS ITEM DOES NOT DECIDE. That a press moves the highlight by ONE, or in the
// right direction (`controls/menu-down-arrow`, `controls/menu-up-arrow`,
// `controls/menu-s`, `controls/menu-w`), where the highlight lands when a move crosses
// an end (`screens/menu-wraps-up`, `screens/menu-wraps-down`), nor that the highlight
// is DRAWN (`screens/title-menu-highlight`).

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import {
  GAMEOVER_ITEMS,
  KEYS_MENU_DOWN,
  KEYS_THRUST,
  PAUSE_ITEMS,
  TITLE_ITEMS,
} from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  SETTLE_TICKS,
  reachGameOver,
  reachPaused,
  reachTitle,
} from "./screens";

/** The key that moves a selection down (`specs/controls.md`). */
const DOWN_KEY = KEYS_MENU_DOWN[0];
/** The key that moves it up. It thrusts while playing; on a menu it moves the highlight. */
const UP_KEY = KEYS_THRUST[0];

/** How many presses each direction is driven for, as the item states. */
const PRESSES = 10;

/** The entry every run starts from. */
const START_ENTRY = 0;

/** The score and wave posed behind the game-over screen: a run that really finished. */
const FINAL_SCORE = 470;
const FINAL_WAVE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Drive one key `PRESSES` times, reading `menuIndex` after every one of them. */
async function sweep(
  key: string,
  entries: number,
  menu: string,
): Promise<void> {
  for (let press = 1; press <= PRESSES; press += 1) {
    await h.tap(key);
    await h.advance(SETTLE_TICKS);
    const { menuIndex } = await h.snapshot();
    assertBetween(
      menuIndex,
      0,
      entries - 1,
      `${menu}: menuIndex after ${press} presses of ${key}, of ${entries} entries (specs/controls.md)`,
    );
  }
}

/** Drive both directions on one menu, from its first entry. */
async function driveMenu(entries: number, menu: string): Promise<void> {
  await h.debug.setMenuIndex(START_ENTRY);
  assertEqual(
    (await h.snapshot()).menuIndex,
    START_ENTRY,
    `${menu}: the entry the run starts from`,
  );
  await sweep(DOWN_KEY, entries, menu);
  await sweep(UP_KEY, entries, menu);
}

it("keeps menuIndex inside the entries of the title, pause and game-over menus", async () => {
  await reachTitle(h);
  await driveMenu(TITLE_ITEMS.length, "the title menu");
  await captureStill(h, "menu");

  await startPlaying(h);
  await reachPaused(h);
  await driveMenu(PAUSE_ITEMS.length, "the pause menu");

  await reachGameOver(h, { score: FINAL_SCORE, wave: FINAL_WAVE });
  await driveMenu(GAMEOVER_ITEMS.length, "the game-over menu");
});
