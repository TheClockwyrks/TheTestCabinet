// Shatter — controls/confirm-space: `Space` pressed on the title menu's first entry
// starts a game.
//
// THE RULE. `specs/controls.md` binds `Space` to "Confirm the selection" on a menu
// and to "Fire the gun" while the game is being played, and settles the ambiguity
// outright: "`Space` fires while the game is being played and confirms on a screen
// showing a menu. The screen decides which meaning applies." Confirming is a press
// edge, "once per press", and "confirming takes the highlighted entry".
// `specs/ui.md` puts `PLAY` first in `TITLE_ITEMS` and says it "opens a new game ...
// and moves to `playing`".
//
// THE AMBIGUITY IS THE POINT, AND IT IS WHY THIS IS A SEPARATE ITEM FROM
// `controls/confirm-enter`. `Enter` confirms and nothing else; `Space` has to be
// resolved by the screen. A build that read the press on the title as a shot — the
// natural fault when one listener owns the key — leaves the game on the title and
// fails here while passing the `Enter` item, which is exactly the split these two
// items exist to make.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page.
// `specs/instrumentation.md` puts the keyboard in the runtime layer an engineless
// build supplies and gives the debug surface no keyboard operation at all, so the
// whole path from the physical key to the opened game is the build's.
//
// WHAT THIS ITEM DOES NOT DECIDE. What a NEW GAME is, which is
// `screens/play-starts-a-game`; nor that `Space` FIRES on the field, which is
// `controls/fire-space`. Only that this key, on this screen, takes the highlighted
// entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS_CONFIRM, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this item decides: the first of the two `specs/controls.md` binds confirm. */
const KEY = KEYS_CONFIRM[0];

/** The title menu's first entry, `PLAY` (`specs/ui.md`). */
const PLAY_ENTRY = 0;

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

it("starts a game when Space is pressed on the title menu's first entry", async () => {
  assertEqual(
    TITLE_ITEMS[PLAY_ENTRY],
    "PLAY",
    "the title menu's first entry, which specs/ui.md fixes",
  );

  await h.debug.reset();
  await h.debug.setMenuIndex(PLAY_ENTRY);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the screen reset left the game on");
  assertEqual(
    posed.menuIndex,
    PLAY_ENTRY,
    "the entry the highlight was posed on",
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "confirmed");

  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen Space opened from the title menu's first entry",
  );
});
