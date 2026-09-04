// Shatter — controls/menu-down-arrow: `ArrowDown` pressed on a menu raises
// `menuIndex` by one.
//
// THE RULE. `specs/controls.md` binds `ArrowDown` to "Move the selection down" on a
// menu — and, uniquely among the movement keys, to NOTHING at all while the game is
// being played — reads the move as a press edge, and fixes what a move is: "the up
// and down inputs move the highlight by one entry and wrap at both ends".
// `specs/instrumentation.md` reports the highlight as `menuIndex`, "the highlighted
// entry, from 0", so a move down is that number rising by one.
//
// WHY THE PAUSE MENU, AND WHY FROM THE FIRST ENTRY. Three entries is what it takes
// to tell the wrong models apart, and `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives three. Posed on entry `0`, a
// build that moves the highlight down by one reads `1`, and every wrong model reads
// something else: one that moved UP instead wraps to `2`, one that jumped to the last
// entry reads `2`, and one that did nothing at all — or jumped to the first — stays
// at `0`. On the two-entry title menu all of those collapse onto the same number, and
// a build that had swapped its two directions would pass both this item and
// `controls/menu-up-arrow`.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page, delivered by its
// `code`. `specs/instrumentation.md` puts the keyboard in the runtime layer an
// engineless build supplies and gives the debug surface no keyboard operation at
// all, so the whole path from the physical key to the moved highlight is the
// build's.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the highlight WRAPS, or that it never leaves
// the menu's entries — `screens/menu-selection-stays-in-range`. Nor that the
// highlighted entry is DRAWN differently from the rest, which is
// `screens/title-menu-highlight`. Nor where confirming would lead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS_MENU_DOWN, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides: the first of the two `specs/controls.md` binds down. */
const KEY = KEYS_MENU_DOWN[0];

/** The entries `specs/ui.md` gives the pause menu, which the pair below rests on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the first, where every wrong model differs. */
const MENU_FROM = 0;
/** Where one entry down from it is. */
const MENU_TO = 1;

/**
 * One tick run after the press, before the reading is taken.
 *
 * `tap` already runs the tick that delivers the key, so a build that acts on the
 * press edge inside that tick has acted before this. This one tick is for the build
 * that LATCHES the edge and drains it at the top of the next tick, which
 * `specs/controls.md` leaves open: it fixes the press edge as the trigger and says
 * nothing about which tick the effect must land on. It costs nothing either way —
 * `tap` has already released the key, so no further edge can arrive in it.
 */
const SETTLE_TICKS = 1;

/**
 * The quiet stretch driven on the posed menu before the key goes down, in ticks.
 *
 * A quarter of a second. Without it, "the highlight ended on `MENU_TO`" is also
 * true of a build whose highlight moves on its own — one that cycles the selection
 * on a timer, or advances it every tick the menu is up — and the item would be
 * decided by where that drift happened to be rather than by the key it is about.
 * `specs/controls.md` moves the highlight on a menu INPUT; a menu left alone holds
 * still, and `specs/ui.md` advances nothing on a paused game.
 */
const QUIET_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises menuIndex by one when ArrowDown is pressed on a menu", async () => {
  assertEqual(
    PAUSE_ITEMS.length,
    MENU_ENTRIES,
    "the pause menu entries specs/ui.md fixes, which this item's figures rest on",
  );

  await startPlaying(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(MENU_FROM);

  await h.advance(QUIET_TICKS);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the menu was posed on");
  assertEqual(
    posed.menuIndex,
    MENU_FROM,
    `the highlighted entry after ${String(QUIET_TICKS)} ticks on the ` +
      "paused screen with no key down — the highlight was posed there and " +
      "moves only on a menu input (specs/controls.md)",
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "menu");

  const moved = await h.snapshot();
  assertEqual(
    moved.screen,
    "paused",
    "the screen still showing after the press",
  );
  assertEqual(
    moved.menuIndex,
    MENU_TO,
    "the entry one press of ArrowDown left the highlight on",
  );
});
