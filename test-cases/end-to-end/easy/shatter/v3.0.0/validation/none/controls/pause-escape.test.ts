// Shatter — controls/pause-escape: `Escape` pressed during live play gives the
// paused screen.
//
// THE RULE. `specs/controls.md` binds `Escape` to "Pause" while the game is being
// played and to "Leave the screen" otherwise, and says outright which applies where:
// "`Escape` pauses while the game is being played and leaves the screen otherwise.
// The screen decides which meaning applies." `specs/ui.md` names the screen it
// reaches, `paused`, "reached by pausing during live play".
//
// THE AMBIGUITY IS THE POINT. One physical `Escape` carries both meanings at once,
// so a build must resolve it by the screen it is on rather than by which listener
// happened to register last. Pressing the real key is what puts that ambiguity in
// front of the build; raising a "pause" by any other route would decide it for the
// build and grade nothing. A build that read the press as "leave the screen" and
// went back to the title fails here, which is exactly the fault this item exists to
// name.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, so what reaches the
// build is a browser-trusted DOM key event on the real page.
// `specs/instrumentation.md` puts the keyboard in the runtime layer an engineless
// build supplies and gives the debug surface no keyboard operation at all, so the
// whole path from the physical key to the paused screen is the build's.
//
// IT OPENS A SCREEN, IT DOES NOT BLINK ONE. The game is left running after the
// press, so a build that pauses on the press and resumes on the release — reading
// the key as a level rather than as the press edge `specs/controls.md` requires — is
// caught rather than photographed at its one paused tick.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the paused field is FROZEN
// (`screens/pause-freezes-the-field`), what the pause menu shows
// (`screens/pause-menu-entries`), or where any of its entries lead. Only that this
// key, on this screen, opens that screen.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_BACK } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides. `specs/controls.md` binds `Escape` to pause and back. */
const KEY = KEY_BACK;

/** Ticks of live play before the press, so what is paused is a game in motion. */
const LIVE_TICKS = ticksFor(0.4);

/** Ticks held after the press, long enough that a pause that blinked would show. */
const PAUSED_TICKS = ticksFor(0.7);

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

it("pauses a game in play when Escape is pressed", async () => {
  await startPlaying(h);
  await h.advance(LIVE_TICKS);
  assertEqual(
    (await h.snapshot()).screen,
    "playing",
    "the screen before the press",
  );

  await h.tap(KEY);
  await h.advance(SETTLE_TICKS);
  await captureStill(h, "paused");
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen Escape gave a game in play",
  );

  await h.advance(PAUSED_TICKS);
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen still showing seven tenths of a second after the press",
  );
});
