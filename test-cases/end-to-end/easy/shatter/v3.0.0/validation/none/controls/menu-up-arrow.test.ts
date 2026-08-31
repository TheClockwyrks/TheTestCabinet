// Shatter — controls/menu-up-arrow: `ArrowUp` pressed on a menu lowers `menuIndex`
// by one.
//
// THE RULE. `specs/controls.md` binds `ArrowUp` to "Move the selection up" on a menu,
// reads the move as a press edge, and fixes what a move is: "the up and down inputs
// move the highlight by one entry and wrap at both ends".
// `specs/instrumentation.md` reports the highlight as `menuIndex`, "the highlighted
// entry, from 0", so a move up is that number falling by one.
//
// `ArrowUp` CARRIES A SECOND MEANING, AND THIS IS THE MENU ONE. The same key thrusts
// while the game is being played (`controls/thrust-up`), and `specs/controls.md`
// gives the two meanings in two columns of one table, the screen deciding which
// applies. The game is posed on a menu, so what the key must do here is move the
// highlight — and a build that answered by thrusting would leave the highlight where
// it was and fail.
//
// WHY THE PAUSE MENU, AND WHY FROM THE LAST ENTRY. Three entries is what it takes to
// tell the wrong models apart, and `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives three. Posed on entry `2`, a
// build that moves the highlight up by one reads `1`, and every wrong model reads
// something else: one that moved DOWN instead wraps to `0`, one that jumped to the
// first entry reads `0`, and one that did nothing at all — or jumped to the last —
// stays at `2`. On the two-entry title menu all of those collapse onto the same
// number, and a build that had swapped its two directions would pass both this item
// and `controls/menu-down-arrow`.
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
// `screens/title-menu-highlight`. Nor where confirming would lead. One key, one
// entry of movement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS_THRUST, PAUSE_ITEMS } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this item decides: the first of the two `specs/controls.md` binds up. */
const KEY = KEYS_THRUST[0];

/** The entries `specs/ui.md` gives the pause menu, which the pair below rests on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the last, where every wrong model differs. */
const MENU_FROM = 2;
/** Where one entry up from it is. */
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers menuIndex by one when ArrowUp is pressed on a menu", async () => {
  assertEqual(
    PAUSE_ITEMS.length,
    MENU_ENTRIES,
    "the pause menu entries specs/ui.md fixes, which this item's figures rest on",
  );

  await startPlaying(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(MENU_FROM);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the menu was posed on");
  assertEqual(
    posed.menuIndex,
    MENU_FROM,
    "the entry the highlight was posed on",
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
    "the entry one press of ArrowUp left the highlight on",
  );
});
