// controls/confirm-space — `Space` takes the highlighted menu item.
//
// specs/controls.md binds the `confirm` action to `Enter` and `Space` and gives
// it one effect — "Accepts the highlighted menu item" — read as a press edge,
// "once per press". specs/ui.md says what a menu does with it: "`confirm` takes
// the highlighted item", and the title menu's second item, `HOW TO PLAY`, "Moves
// to `howto`". So: open the game at its title, put the highlight on that item,
// press the key once, and read the screen.
//
// `Space` DRIVES TWO ACTIONS, and this is the confirm half. specs/controls.md
// binds it to the two fire actions as well, and settles which applies where:
// "`Space` fires while the game is being played and confirms on a screen showing
// a menu." The title is a screen showing a menu, and that is the only screen
// this point presses it on; the firing half is controls/space-fires'.
//
// It is also the SECOND of the two keys the `confirm` row binds. `Enter` is
// controls/confirm-enter's, and the two are separate points because a build that
// wired one and not the other must grade differently from one that wired
// neither — which is also why this point is capped `scuffed` where `Enter` is
// `broken`: a player who lost only this half can still leave the menu.
//
// THE HIGHLIGHT IS POSED ON THE SECOND ITEM, NOT THE FIRST, so every wrong model
// reads a different screen and a failure names which one the build implemented:
// a key that did nothing leaves `title`, a build that confirms whatever item it
// likes rather than the highlighted one opens a run and reads `playing`, and the
// conforming build reads `howto`. Posed on the first item the first two of those
// would have been indistinguishable from each other.
//
// WHAT THIS DOES NOT DECIDE. That `DESCEND` opens a run, which is
// screens/title-descend-starts'; what the how-to screen SHOWS, which is
// screens/title-howto's and screens/howto-copy's; and how the highlight is
// MOVED, which is controls/menu-down's and controls/menu-up's — which is why the
// highlight is posed through the surface here rather than walked to with a
// movement key.
//
// THE KEY IS HELD FOR ONE FRAME rather than tapped between frames. The engine
// reports an action's press edge and its held value, and one frame with the key
// down arms the edge AND raises the value for exactly one frame, so a build
// reading either confirms exactly once.
//
// THE WORLD IS THE ONE `reset` LEAVES. specs/instrumentation.md has `reset`
// restore `screen` to `"title"` and `menuIndex` to `0` and empty the node field
// and the worm, foe, bolt and arc rosters, so the game stands exactly where a
// player finds it on opening it, with nothing on the board.

import { afterEach, beforeEach, it } from "vitest";
import { TITLE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  resetTo,
  type Harness,
} from "../harness";

/** The second key specs/controls.md binds the `confirm` action to. */
const KEY = "Space";

/** Frames the key is down: one, which is one press. */
const PRESS_TICKS = 1;

/**
 * Frames between the press and the reading.
 *
 * A beat, not a measurement: `holdFor` runs the frame that delivers the key, and
 * these follow it so a build that takes the transition at the top of the next
 * frame reads the same as one that takes it in the frame the key arrived on.
 */
const BEAT_TICKS = 4;

/** Frames held on the screen that opened, so the still is drawn settled. */
const SETTLE_TICKS = 20;

/** The title item the highlight is posed on: `HOW TO PLAY` (specs/ui.md). */
const ITEM_INDEX = 1;

/** The screen specs/ui.md says that item opens. */
const OPENS = "howto";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the highlighted title item on Space", async () => {
  resetTo(h);
  h.debug.setMenuIndex(ITEM_INDEX);

  const before = h.snapshot();
  await holdFor(h, KEY, PRESS_TICKS);
  await h.advance(BEAT_TICKS);
  const pressed = h.snapshot();
  await h.advance(SETTLE_TICKS);
  // Before the assertions, so a check that fails still leaves the picture of
  // the screen the key actually opened.
  captureStill(h, "confirmed");

  assertEqual(
    before.screen,
    "title",
    "the game is on the title menu before the key, which is the screen this " +
      "point's claim is about (specs/ui.md)",
  );
  assertEqual(
    before.menuIndex,
    ITEM_INDEX,
    `the highlight rests on ${JSON.stringify(TITLE_ITEMS[ITEM_INDEX])}, ` +
      `item ${ITEM_INDEX} of the title menu, before the key`,
  );
  assertEqual(
    pressed.screen,
    OPENS,
    `the screen one press of ${KEY} opens from the title menu with ` +
      `${JSON.stringify(TITLE_ITEMS[ITEM_INDEX])} highlighted ` +
      `(specs/controls.md, specs/ui.md)`,
  );
});
