// controls/menu-down-arrow — `ArrowDown` pressed on a menu raises `menuIndex` by
// one.
//
// THE RULE. `specs/controls.md` binds `ArrowDown` to the `down` action, whose menu
// column reads "Move the selection down" and whose playing column is empty — so
// `down` does one thing in the whole game and this is it. The move is a press edge,
// and "the up and down inputs move the highlight by one entry and wrap at both
// ends". `specs/instrumentation.md` reports the highlight as `menuIndex`, "the
// highlighted entry, from 0", so a move down is that number rising by one.
//
// WHY THE PAUSE MENU, AND WHY FROM THE FIRST ENTRY. Three entries is what it takes
// to tell the wrong models apart, and `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives three. Posed on entry `0`, a
// build that moves the highlight down by one reads `1`, and every wrong model reads
// something else: one that moved UP instead wraps to `2`, one that jumped to the
// last entry reads `2`, and one that did nothing at all — or jumped to the first —
// stays at `0`. On the two-entry title menu all of those collapse onto the same
// number, and a build that had swapped its two directions would pass both this item
// and `controls/menu-up-arrow`.
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
// WHAT THIS ITEM DOES NOT DECIDE. That the highlight WRAPS, or that it never leaves
// the menu's entries — `screens/menu-selection-stays-in-range`. Nor that the
// highlighted entry is DRAWN differently from the rest, which is
// `screens/title-menu-highlight`. Nor where confirming would lead.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS } from "../../src/constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "ArrowDown";
const ACTION = "down";

/** The entries `specs/ui.md` gives the pause menu, which the pair below rests on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the first, where every wrong model differs. */
const MENU_FROM = 0;
/** Where one entry down from it is. */
const MENU_TO = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises menuIndex by one when ArrowDown is pressed on a menu", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `down` action to",
  );
  assertEqual(
    PAUSE_ITEMS.length,
    MENU_ENTRIES,
    "the pause menu entries specs/ui.md fixes, which this item's figures rest on",
  );

  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(MENU_FROM);

  const posed = h.snapshot();
  assertEqual(posed.screen, "paused", "the screen the menu was posed on");
  assertEqual(
    posed.menuIndex,
    MENU_FROM,
    "the entry the highlight was posed on",
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
    "the entry one press of ArrowDown left the highlight on",
  );
});
