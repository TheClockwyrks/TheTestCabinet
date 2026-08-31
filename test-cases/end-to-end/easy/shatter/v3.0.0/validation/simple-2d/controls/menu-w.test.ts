// controls/menu-w — `KeyW` pressed on a menu lowers `menuIndex` by one.
//
// THE RULE. `specs/controls.md`'s binding table gives the `up` action two keys,
// `ArrowUp` and `KeyW`, and `up`'s menu column reads "Move the selection up", so
// `KeyW` is the WASD half of the menu's up input rather than a second, lesser
// binding. The move is a press edge, and "the up and down inputs move the highlight
// by one entry and wrap at both ends". `specs/instrumentation.md` reports the
// highlight as `menuIndex`, "the highlighted entry, from 0", so a move up is
// that number falling by one.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/menu-up-arrow`. The two keys are one row
// of the binding table, and under this engine one registration — but a build
// registers the action itself, and the commonest way to lose one is to hand the
// engine the arrows and forget the letters. That fault is invisible on the field,
// where the same letters drive the same action for flight, and shows only on a
// menu. This item drives `KeyW` and nothing else.
//
// `KeyW` CARRIES A SECOND MEANING, AND THIS IS THE MENU ONE. The same key thrusts
// while the game is being played (`controls/thrust-w`) through the very same `up`
// action; the game is posed on a menu, so what the build must do with that action
// here is move the highlight.
//
// WHY THE PAUSE MENU, AND WHY FROM THE LAST ENTRY. Three entries is what it takes
// to tell the wrong models apart, and `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives three. Posed on entry `2`, a
// build that moves the highlight up by one reads `1`, and every wrong model reads
// something else: one that moved DOWN instead wraps to `0`, one that jumped to the
// first entry reads `0`, and one that did nothing at all — or jumped to the last —
// stays at `2`.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, delivered by their `code` — which is what makes
// `KeyW` the PHYSICAL key rather than the character a layout happens to put there.
// A press is "news for exactly one frame", so an edge-reading build answers in the
// first frame and a latching build in the second, and both are read.
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
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyW";
const ACTION = "up";

/** The entries `specs/ui.md` gives the pause menu, which the pair below rests on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the last, where every wrong model differs. */
const MENU_FROM = 2;
/** Where one entry up from it is. */
const MENU_TO = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lowers menuIndex by one when KeyW is pressed on a menu", async () => {
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
    "the entry one press of KeyW left the highlight on",
  );
});
