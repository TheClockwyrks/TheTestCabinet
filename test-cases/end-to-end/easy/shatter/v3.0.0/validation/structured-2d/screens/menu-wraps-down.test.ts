// screens/menu-wraps-down — a move down from the last entry lands on the first.
//
// `specs/controls.md`, on menus: "The up and down inputs move the highlight by
// one entry and wrap at both ends, so moving down from the last entry highlights
// the first and moving up from the first highlights the last."
// `specs/instrumentation.md` reports the highlight as `menuIndex`, "the
// highlighted entry, from 0", so the down edge of that rule is a posed last
// entry reading `0` after one move.
//
// WHY THE WRAP IS ITS OWN POINT. A build that CLAMPS at the ends is the ordinary
// way this sentence is missed, and clamping costs nothing anywhere else: the
// index never leaves the entry count, so `screens/menu-selection-stays-in-range`
// passes, and every `controls/menu-*` item moves from an interior entry, so
// those pass too. Without this point the rule is stated and never graded.
//
// THE PAUSE MENU, POSED ON ITS LAST ENTRY. `specs/ui.md` fixes `PAUSE_ITEMS` at
// THREE entries, and three is what tells a wrap from the two things it is
// confused with: from entry `2`, a wrap reads `0`, a clamp stays at `2`, and a
// build that moved UP instead reads `1`. On either two-entry menu a wrap and a
// crossed direction land on the same number.
//
// THE FIELD IS EMPTY, QUIET AND FROZEN. `startPlaying` clears the field and
// holds the wave loop, the saucer's arrival and the ship's lethal contact off,
// and `specs/ui.md` fixes that a paused game advances nothing — so nothing but
// the move can reach the highlight. The index is read before the press as well,
// so a build whose highlight drifts on its own fails naming that.
//
// THE ACTION IS DRIVEN, NOT A NAMED KEY. Which keys are bound to the move is
// `controls/menu-down-arrow`'s and `controls/menu-s`'s point; this one is about
// what the move does at the end of a menu, so it goes through `tapAction` and
// takes whichever key the binding table names first.
//
// WHAT THIS DOES NOT DECIDE. That an interior move goes one entry
// (`controls/menu-*`), that the index stays inside the entries
// (`screens/menu-selection-stays-in-range`), that the highlight is DRAWN
// distinctly (`screens/title-menu-highlight`), or the other end of the wrap
// (`screens/menu-wraps-up`).

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** The entries `specs/ui.md` gives the pause menu: RESUME, RESTART, QUIT TO MENU. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the last, where the down wrap is. */
const POSED_AT = MENU_ENTRIES - 1;

/** Where one move down from the last entry lands: the first one. */
const LANDS_ON = 0;

/** The quiet stretch driven before the move, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the highlight from the last entry to the first when down is pressed", async () => {
  // The pause menu over the empty, quiet field `startPlaying` leaves, with the
  // highlight posed on the last of its three entries.
  startPlaying(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(POSED_AT);

  await h.advance(QUIET_TICKS);
  const quiet = h.snapshot();

  await tapAction(h, "down");
  const pressed = h.snapshot();
  captureStill(h, "menu");

  // The figures below rest on the menu specs/ui.md fixes, so the menu it fixes
  // is asserted rather than assumed.
  assertLength(
    PAUSE_ITEMS,
    MENU_ENTRIES,
    "the entries specs/ui.md gives the pause menu, which this item's two " +
      "figures rest on",
  );
  assertEqual(quiet.screen, "paused", "the screen the menu was posed on");
  assertEqual(
    pressed.screen,
    "paused",
    "the screen still showing after one move down — a menu input moves the " +
      "highlight and does nothing else (specs/controls.md, specs/ui.md)",
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
    `the highlighted entry after one move down from entry ` +
      `${String(POSED_AT)} of the pause menu's ` +
      `${String(PAUSE_ITEMS.length)} — moving down from the last entry ` +
      "highlights the first (specs/controls.md)",
  );
});
