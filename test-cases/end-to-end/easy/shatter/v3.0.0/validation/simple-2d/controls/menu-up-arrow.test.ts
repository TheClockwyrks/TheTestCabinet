// controls/menu-up-arrow — `ArrowUp` pressed on a menu lowers `menuIndex` by one.
//
// THE RULE. `specs/controls.md` binds `ArrowUp` to the `up` action, whose menu
// column reads "Move the selection up", and fixes what a move is: "the up and down
// inputs move the highlight by one entry and wrap at both ends".
// `specs/instrumentation.md` reports the highlight as `menuIndex`, "the
// highlighted entry, from 0", so a move up is that number falling by one.
//
// `ArrowUp` CARRIES A SECOND MEANING, AND THIS IS THE MENU ONE. The same key
// thrusts while the game is being played (`controls/thrust-up`) through the very
// same `up` action, and `specs/controls.md` gives the two meanings in two columns
// of one table, the screen deciding which applies. Under this engine the engine
// hands the build one action and no screen with it, so resolving the two meanings
// is entirely the build's: the game is posed on a menu, and a build that answered
// by thrusting would leave the highlight where it was and fail.
//
// WHY THE PAUSE MENU, AND WHY FROM THE LAST ENTRY. Three entries is what it takes
// to tell the wrong models apart, and `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives three. Posed on entry `2`, a
// build that moves the highlight up by one reads `1`, and every wrong model reads
// something else: one that moved DOWN instead wraps to `0`, one that jumped to the
// first entry reads `0`, and one that did nothing at all — or jumped to the last —
// stays at `2`. On the two-entry title menu all of those collapse onto the same
// number, and a build that had swapped its two directions would pass both this item
// and `controls/menu-down-arrow`.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does. That contract also makes a press "news for
// exactly one frame", so a build reading the armed edge answers in the first of the
// two frames and a build that latched it answers in the second — and because the
// key is up before the second frame runs, a build reading the HELD value instead of
// the edge still moves the highlight only one entry.
//
// WHAT THE SPECIFICATION LEAVES OPEN, AND THIS ITEM THEREFORE DOES NOT DECIDE.
// `specs/controls.md`'s "Holds and presses" section classifies rotation, thrust and
// firing, and calls confirming, leaving a screen, pausing and muting press edges
// "once per press" — but it says nothing about the two MENU MOVES, so whether a
// HELD up or down key repeats is unstated. Nothing here demands either reading: the
// key is down for exactly one frame, so a build that answers the armed edge and a
// build that answers the held value both move the highlight by the one entry the
// specification does fix.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the highlight WRAPS at the ends of the menu
// (`screens/menu-wraps-up`, `screens/menu-wraps-down`), or that it never leaves the
// menu's entries (`screens/menu-selection-stays-in-range`). Nor that the
// highlighted entry is DRAWN differently from the rest, which is
// `screens/title-menu-highlight`. Nor where confirming would lead. One key, one
// entry of movement.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "ArrowUp";
const ACTION = "up";

/** The entries `specs/ui.md` gives the pause menu, which the pair below rests on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the last, where every wrong model differs. */
const MENU_FROM = 2;
/** Where one entry up from it is. */
const MENU_TO = 1;

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

afterEach(() => {
  h?.dispose();
});

it("lowers menuIndex by one when ArrowUp is pressed on a menu", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `up` action to",
  );
  assertEqual(
    PAUSE_ITEMS.length,
    MENU_ENTRIES,
    "the pause menu entries specs/ui.md fixes, which this item's figures rest on",
  );

  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(MENU_FROM);

  await h.advance(QUIET_TICKS);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the menu was posed on");
  assertEqual(
    posed.menuIndex,
    MENU_FROM,
    `the highlighted entry after ${String(QUIET_TICKS)} ticks on the ` +
      "paused screen with no key down — the highlight was posed there and " +
      "moves only on a menu input (specs/controls.md)",
  );

  await h.tap(KEY);
  captureStill(h, "menu");

  const moved = h.snapshot();
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
