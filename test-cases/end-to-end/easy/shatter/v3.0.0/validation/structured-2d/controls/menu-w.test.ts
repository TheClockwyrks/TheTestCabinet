// controls/menu-w — `KeyW` moves a menu selection up.
//
// `specs/controls.md` binds `KeyW` to the `up` action and gives `up` its
// meaning on a menu — "Move the selection up" — and the same file's Menus
// section says what that move is: "The up and down inputs move the highlight
// by one entry and wrap at both ends."
//
// THE KEY IS DRIVEN, NOT THE ACTION. `specs/instrumentation.md` carries no
// operation that moves a highlight, and this point is about one BINDING, so
// the literal `KeyboardEvent.code` the specification's table names is what
// goes down. `harness.ts`'s `tapAction` drives an action's FIRST bound key,
// which would grade the two keys bound to `up` as one thing; the whole point
// of this item and of `controls/menu-up-arrow` is that they are two.
//
// THE PAUSE MENU, POSED IN THE MIDDLE. `specs/ui.md` fixes `PAUSE_ITEMS` at
// THREE entries, and the highlight is posed on the middle one. That is what
// makes the reading unambiguous: from entry `1` of three, up gives `0` and
// down gives `2`, so a build that wired the two directions the wrong way round
// reads as a DIFFERENT NUMBER rather than as the right one. On either two-
// entry menu — the title's or the game-over's — a move up and a move down from
// the same entry land on the same place, and a check posed there would pass a
// build with its directions crossed.
//
// THE FIELD IS EMPTY, QUIET AND FROZEN. `startPlaying` clears the field and
// holds the wave loop, the saucer's arrival and the ship's lethal contact off,
// and `specs/ui.md` fixes that a paused game advances nothing — so nothing but
// the key can reach the highlight. The index is read before the press as well,
// so a build whose highlight drifts on its own fails naming that rather than
// the binding.
//
// ONE MOVE, NOT A WRAP. The press is a single edge and the entry it lands on
// is an interior one, so nothing here depends on what happens at the ends of
// the menu: that is `screens/menu-selection-stays-in-range`'s.
//
// WHAT THIS DOES NOT DECIDE. That the highlight is DRAWN distinctly
// (`screens/title-menu-highlight`), that it stays inside the entries
// (`screens/menu-selection-stays-in-range`), where a confirmed entry leads
// (`screens/*`), what `KeyW` does while the game is being played
// (`controls/thrust-w`), and the other key bound to `up`.

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../../src/constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "KeyW";

/**
 * The entry the highlight is posed on: the middle of the pause menu's three.
 *
 * `specs/ui.md` fixes `PAUSE_ITEMS` as `RESUME`, `RESTART`, `QUIT TO MENU`, so
 * entry `1` has an entry either side of it and the two directions land on two
 * different numbers.
 */
const POSED_AT = 1;

/** Where one move up from `POSED_AT` lands: by one entry, without wrapping. */
const LANDS_ON = POSED_AT - 1;

/** The entries `specs/ui.md` gives the pause menu: RESUME, RESTART, QUIT TO MENU. */
const MENU_ENTRIES = 3;

/** The quiet stretch driven before the key goes down, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the highlight up by one entry when KeyW is pressed on a menu", async () => {
  // The pause menu over the empty, quiet field `startPlaying` leaves, with the
  // highlight posed on the middle of its three entries.
  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(POSED_AT);

  await h.advance(QUIET_TICKS);
  const quiet = h.snapshot();

  await h.tap(KEY);
  const pressed = h.snapshot();
  captureStill(h, "menu");

  // The figures below rest on the menu specs/ui.md fixes, so the menu it
  // fixes is asserted rather than assumed.
  assertLength(
    PAUSE_ITEMS,
    MENU_ENTRIES,
    "the entries specs/ui.md gives the pause menu, which this item's two " +
      "figures rest on",
  );
  assertEqual(
    quiet.screen,
    "paused",
    "the screen the menu was posed on",
  );
  assertEqual(
    pressed.screen,
    "paused",
    `the screen still showing after one press of ${KEY} — a menu input `+
      "moves the highlight and does nothing else, so a build that leaves " +
      "the pause menu on it has answered the wrong action " +
      "(specs/controls.md, specs/ui.md)",
  );

  assertEqual(
    quiet.menuIndex,
    POSED_AT,
    `the highlighted entry after ${String(QUIET_TICKS)} ticks on the paused ` +
      "screen with no key down — the highlight moves only on a menu input " +
      "(specs/controls.md), and a paused game advances nothing (specs/ui.md)",
  );
  assertEqual(
    pressed.menuIndex,
    LANDS_ON,
    `the highlighted entry after one press of ${KEY} from entry ` +
      `${String(POSED_AT)} of the pause menu's ` +
      `${String(PAUSE_ITEMS.length)} — the up input moves the ` +
      "highlight up by ONE entry (specs/controls.md)",
  );
});
