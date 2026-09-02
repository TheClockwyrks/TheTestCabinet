// controls/menu-s — `KeyS` pressed on a menu raises `menuIndex` by one.
//
// THE RULE. `specs/controls.md`'s binding table gives the `down` action two keys,
// `ArrowDown` and `KeyS`, and `down`'s menu column reads "Move the selection down"
// while its playing column is empty — so `KeyS` does one thing in the whole game
// and this is it. What a move is, is fixed: "the up and down inputs move the
// highlight by one entry and wrap at both ends". `specs/instrumentation.md` reports
// the highlight as `menuIndex`, "the highlighted entry, from 0", so a move down
// is that number rising by one.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/menu-down-arrow`. The two keys are one
// row of the binding table, and under this engine one registration — but a build
// registers the action itself, and the commonest way to lose one is to hand the
// engine the arrows and forget the letters. This item drives `KeyS` and nothing
// else.
//
// WHY THE PAUSE MENU, AND WHY FROM THE FIRST ENTRY. Three entries is what it takes
// to tell the wrong models apart, and `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives three. Posed on entry `0`, a
// build that moves the highlight down by one reads `1`, and every wrong model reads
// something else: one that moved UP instead wraps to `2`, one that jumped to the
// last entry reads `2`, and one that did nothing at all — or jumped to the first —
// stays at `0`.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, delivered by their `code` — which is what makes
// `KeyS` the PHYSICAL key rather than the character a layout happens to put there.
// A press is "news for exactly one frame", so an edge-reading build answers in the
// first frame and a latching build in the second, and both are read.
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
// WHAT THIS ITEM DOES NOT DECIDE. That the highlight WRAPS, or that it never leaves
// the menu's entries — `screens/menu-selection-stays-in-range`. Nor that the
// highlighted entry is DRAWN differently from the rest.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, PAUSE_ITEMS } from "../../src/constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyS";
const ACTION = "down";

/** The entries `specs/ui.md` gives the pause menu, which the pair below rests on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the first, where every wrong model differs. */
const MENU_FROM = 0;
/** Where one entry down from it is. */
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

it("raises menuIndex by one when KeyS is pressed on a menu", async () => {
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
    "the entry one press of KeyS left the highlight on",
  );
});
