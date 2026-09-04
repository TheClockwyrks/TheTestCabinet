// screens/menu-wraps-up — a move up from the first entry lands on the last.
//
// THE RULE. `specs/controls.md`, under Menus: "The up and down inputs move the
// highlight by one entry and wrap at both ends, so moving down from the last
// entry highlights the first and moving up from the first highlights the last."
// `specs/instrumentation.md` reports the highlight as `menuIndex`, "the
// highlighted entry, from 0", so the up edge of that rule is a posed `0` reading
// as the last entry's number after one press.
//
// WHY IT IS A POINT OF ITS OWN. Clamping at the ends is the ordinary way this
// rule is missed, and a build that clamps passes every other menu point: it
// never leaves the entry count (`screens/menu-selection-stays-in-range`), and
// the four `controls/menu-*` items all move from an interior entry. The
// behavior the specification states in so many words would otherwise cost
// nothing to miss.
//
// WHY THE PAUSE MENU, AND WHY ONE PRESS. `PAUSE_ITEMS` — `RESUME`, `RESTART`,
// `QUIT TO MENU` — is the only menu `specs/ui.md` gives THREE entries, and three
// is what tells a wrap from a toggle: from `0` a wrap reads `2`, while a build
// that clamps stays at `0` and one that moved down instead reads `1`. One press,
// because the rule is about the single move that crosses the end.
//
// THE MOVE IS DRIVEN AS A KEY, through the action's first bound key, so what the
// engine hands the build is a real registered action. WHICH key is bound to the
// move is `controls/menu-up-arrow`'s and `controls/menu-w`'s point, not this
// one, so this suite asks `keyFor` for it rather than naming one.
//
// WHAT THIS ITEM DOES NOT DECIDE. That an interior move goes one entry
// (`controls/menu-up-arrow`, `controls/menu-w`), that the index never leaves the
// entries (`screens/menu-selection-stays-in-range`), that the highlight is DRAWN
// (`screens/title-menu-highlight`), or the other end of the wrap
// (`screens/menu-wraps-down`).

import { afterEach, beforeEach, it } from "vitest";
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The entries `specs/ui.md` gives the pause menu, which the figures below rest on. */
const MENU_ENTRIES = 3;

/** The entry the highlight is posed on: the first, which is where the up wrap is. */
const MENU_FROM = 0;
/** Where one move up from the first entry lands: the last one. */
const MENU_TO = MENU_ENTRIES - 1;

/**
 * The quiet stretch driven on the posed menu before the key goes down, in ticks.
 *
 * A quarter of a second. Without it, "the highlight ended on `MENU_TO`" is also
 * true of a build whose highlight moves on its own, and the item would be
 * decided by where that drift happened to be rather than by the press it is
 * about. `specs/controls.md` moves the highlight on a menu INPUT, and
 * `specs/ui.md` advances nothing on a paused game.
 */
const QUIET_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("wraps the highlight from the first entry to the last", async () => {
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
    `the highlighted entry after ${String(QUIET_TICKS)} ticks on the paused ` +
      "screen with no key down — the highlight was posed there and moves only " +
      "on a menu input (specs/controls.md)",
  );

  await h.tap(keyFor("up"));
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
    `the entry one move up from entry ${String(MENU_FROM)} of the pause ` +
      `menu's ${String(PAUSE_ITEMS.length)} left the highlight on — moving up ` +
      "from the first entry highlights the last (specs/controls.md)",
  );
});
