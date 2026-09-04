// Shatter — controls/confirm-enter: `Enter` pressed on the title menu's first entry
// starts a game.
//
// THE RULE. `specs/controls.md` binds `Enter` to "Confirm the selection" on a menu —
// and to nothing at all while the game is being played — and reads confirming as a
// press edge, "once per press". "Confirming takes the highlighted entry, and
// `specs/ui.md` states each screen's entries and where each leads." `specs/ui.md`
// puts `PLAY` first in `TITLE_ITEMS` and says it "opens a new game ... and moves to
// `playing`", with "the highlight rests on the first entry on arriving at the title".
//
// THE ROUTE IS THE TITLE, BECAUSE THAT IS THE ONE SCREEN THE GAME OPENS ON.
// `reset()` restores `screen` to `"title"` and `menuIndex` to `0`
// (`specs/instrumentation.md`), which is the arrangement the item's own description
// names: the title menu, on its first entry. The highlight is then posed at `0`
// explicitly rather than left to the reset, so the check states its own precondition
// and a reader does not have to hold the reset's table in mind.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page.
// `specs/instrumentation.md` puts the keyboard in the runtime layer an engineless
// build supplies and gives the debug surface no keyboard operation at all, so the
// whole path from the physical key to the opened game is the build's. Nothing here
// poses the screen it is looking for: `setScreen("playing")` would answer the
// question for the build.
//
// WHAT THIS ITEM DOES NOT DECIDE. What a NEW GAME is — its lives, its score, its
// wave and its opening rocks are `screens/play-starts-a-game`'s, and asserting them
// here would cost one build two points for one fault. Nor where the menu's SECOND
// entry leads, which is `screens/howto-reachable`. Only that this key, on this
// screen, takes the highlighted entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEYS_CONFIRM, TITLE_ITEMS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";

/** The key this item decides: the second of the two `specs/controls.md` binds confirm. */
const KEY = KEYS_CONFIRM[1];

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

it("starts a game when Enter is pressed on the title menu's first entry", async () => {
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
    "the screen Enter opened from the title menu's first entry",
  );
});
