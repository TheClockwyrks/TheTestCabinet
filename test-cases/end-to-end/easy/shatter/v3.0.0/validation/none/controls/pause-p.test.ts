// Shatter — controls/pause-p: `KeyP` pressed during live play gives the paused
// screen.
//
// THE RULE. `specs/controls.md` binds `KeyP` to "Pause" while the game is being
// played and to nothing at all otherwise, and reads pausing as a press edge, "once
// per press". `specs/ui.md` names the screen it reaches, `paused`, "reached by
// pausing during live play".
//
// WHY IT IS A SEPARATE ITEM FROM `controls/pause-escape`. Two keys pause, and they
// are two listeners in a build. `KeyP` is also the unambiguous one — it carries no
// second meaning anywhere in the key table, where `Escape` carries two — so a build
// that wired only the ambiguous key, or only the plain one, loses exactly one point
// rather than both or neither.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the one tick that delivers it,
// and releases it, all through Chromium's own input pipeline, and delivers it by its
// `code`, so `KeyP` is the PHYSICAL key rather than the character a layout happens to
// put there. `specs/instrumentation.md` puts the keyboard in the runtime layer an
// engineless build supplies and gives the debug surface no keyboard operation at
// all, so the whole path from the physical key to the paused screen is the build's.
//
// IT OPENS A SCREEN, IT DOES NOT BLINK ONE. The game is left running after the
// press, so a build that pauses on the press and resumes on the release — reading
// the key as a level rather than as the press edge `specs/controls.md` requires — is
// caught rather than photographed at its one paused tick.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the paused field is FROZEN
// (`screens/pause-freezes-the-field`), what the pause menu shows
// (`screens/pause-menu-entries`), or where any of its entries lead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { KEY_PAUSE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides. */
const KEY = KEY_PAUSE;

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

it("pauses a game in play when KeyP is pressed", async () => {
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
    "the screen KeyP gave a game in play",
  );

  await h.advance(PAUSED_TICKS);
  assertEqual(
    (await h.snapshot()).screen,
    "paused",
    "the screen still showing seven tenths of a second after the press",
  );
});
