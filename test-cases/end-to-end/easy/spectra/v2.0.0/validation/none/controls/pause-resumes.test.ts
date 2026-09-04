// Spectra — controls/pause-resumes: the pause key pressed on the paused screen
// returns to the live wave.
//
// THE RULE. `specs/controls.md` lists `pause` among the actions the `paused`
// screen reads, and states the return leg explicitly: "`pause` and `back` on the
// paused screen both return to the live wave, with the wave exactly as it was."
// This point decides that return leg for `pause`.
//
// THE PAUSED SCREEN IS POSED, NOT PRESSED INTO. `setScreen("paused")` puts the
// game on the screen this point is about, so the verdict rests on the RESUME
// binding alone. Opening the pause with a key instead would fold the outward leg
// into this point: a build whose `KeyP` did nothing at all would then fail
// `controls/pause-p` and this one, two points for one fault. Reaching the scenario
// directly is also what `specs/instrumentation.md` gives `setScreen` for.
//
// WHY `KeyP` AND NOT `Escape`. Both are bound to `pause`, and on the paused screen
// `Escape` also drives `back` — which the same sentence says returns to the wave
// too. A press of `Escape` that resumed would therefore leave it open which of the
// two readings did the work, and a build that implemented `back` and never
// implemented resume-on-`pause` would pass. `KeyP` drives `pause` and nothing
// else, so what returns the wave here can only be the `pause` action.
// `screens/howto-returns` and `controls/back-escape` grade `back` on their own.
// The cost of that choice is stated plainly: a build that never bound `KeyP` at
// all loses `controls/pause-p` and this point together. It is the honest price of
// the only key that can separate `pause` from `back` on this screen, and the
// alternative is worse — a build that implemented `back` and never implemented
// resume-on-`pause` would pass a check pressed with `Escape`.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the press moved the game back to
// `inWave`, that the wave it returned to is the LIVE phase rather than the `ready`
// hold, and that it stayed there rather than flickering back to the menu. That the
// field behind the pause was frozen and comes back exactly as it was is
// `screens/pause-freezes`'; what the paused screen draws is
// `screens/pause-menu-items`'; that `RESUME` on that menu does the same thing is
// the menu's, not the key's. None is restated here.
//
// THE KEY IS A REAL ONE. `tap` presses the key down, runs exactly one frame with
// it held, and releases it, all through Chromium's own input pipeline. Under this
// engine there is no action layer between the page and the game
// (`specs/instrumentation.md` gives the surface no keyboard operation at all), so
// the whole path from a physical key to a resumed wave is the build's own.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates before the pause is posed, so nothing on the field can move the game
// off `inWave` once the press has returned it there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** The pause binding that drives `pause` and nothing else. */
const PAUSE_KEY = "KeyP";

/**
 * How long the resumed wave is run before it is read again.
 *
 * Seven tenths of a second, long enough that a wave resumed and re-paused on the
 * following frame — or flickering with the browser's key auto-repeat — shows as
 * something other than a live `inWave` at the end of it.
 */
const SETTLE_SECONDS = 0.7;
const SETTLE_FRAMES = framesFor(SETTLE_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the live wave when the pause key is pressed on the paused screen", async () => {
  await startPosed(h);
  await h.debug.setScreen("paused");
  await h.advance(1);

  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the game is on the paused screen");

  await h.tap(PAUSE_KEY);
  await captureStill(h, "resumed");

  const resumed = await h.snapshot();
  assertEqual(resumed.screen, "inWave", "P returned the game to the wave");
  assertEqual(
    resumed.phase,
    "live",
    "and to the live phase it was paused in, rather than the ready hold",
  );

  await h.advance(SETTLE_FRAMES);
  assertEqual(
    (await h.snapshot()).screen,
    "inWave",
    `and the wave was still running ${SETTLE_SECONDS}s later`,
  );
});
