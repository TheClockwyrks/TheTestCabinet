// Spectra — controls/pause-resumes: the pause key pressed on the paused screen
// returns to the live wave.
//
// THE RULE. `specs/controls.md` lists `pause` among the actions the `paused` screen
// reads, and states the return leg explicitly: "`pause` and `back` on the paused
// screen both return to the live wave, with the wave exactly as it was." This point
// decides that return leg for `pause`.
//
// THE PAUSED SCREEN IS POSED, NOT PRESSED INTO. `setScreen("paused")` puts the game
// on the screen this point is about, so the verdict rests on the RESUME binding
// alone. Opening the pause with a key instead would fold the outward leg into this
// point: a build whose `KeyP` did nothing at all would then fail `controls/pause-p`
// and this one, two points for one fault. Reaching the scenario directly is also
// what `specs/instrumentation.md` gives `setScreen` for.
//
// WHY `KeyP` AND NOT `Escape`. Both are bound to `pause`, and on the paused screen
// `Escape` also drives `back` — which the same sentence says returns to the wave
// too. A press of `Escape` that resumed would therefore leave it open which of the
// two readings did the work, and a build that implemented `back` and never
// implemented resume-on-`pause` would pass. `KeyP` drives `pause` and nothing else,
// so what returns the wave here can only be the `pause` action.
// `screens/howto-returns` and `controls/back-escape` grade `back` on their own. The
// cost of that choice is stated plainly: a build that never bound `KeyP` at all loses
// `controls/pause-p` and this point together. It is the honest price of the only key
// that can separate `pause` from `back` on this screen, and the alternative is worse.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the press moved the game back to `inWave`,
// that the wave it returned to is the LIVE phase rather than the `ready` hold, and
// that it stayed there rather than flickering back to the menu. That the field behind
// the pause was frozen and comes back exactly as it was is `screens/pause-freezes`'s;
// what the paused screen draws is `screens/pause-menu-items`'s; that `RESTART` and
// `QUIT TO MENU` on that menu do their own jobs is `screens/pause-restart`'s and
// `screens/pause-quit`'s. None is restated here.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `pause` as an
// edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed edge.
// The event is a `KeyboardEvent`-shaped one dispatched at the engine's own event
// target, which the engine resolves exactly as it resolves a player's key.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's three
// gates before the pause is posed, so nothing on the field can move the game off
// `inWave` once the press has returned it there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * The pause binding that drives `pause` and nothing else.
 *
 * Written out as `specs/controls.md` states it rather than read off the build's
 * `BINDINGS`, so a build that bound the wrong key cannot agree with itself.
 */
const PAUSE_KEY = "KeyP";

/**
 * How long the resumed wave is run before it is read again.
 *
 * Seven tenths of a second, long enough that a wave resumed and re-paused on the
 * following frame shows as something other than a live `inWave` at the end of it. A
 * settling window rather than a figure: the field is empty and the three gates are
 * shut, so a conforming build simply keeps running the wave for as long as it is
 * asked to.
 */
const SETTLE_SECONDS = 0.7;
const SETTLE_TICKS = ticksFor(SETTLE_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the live wave when the pause key is pressed on the paused screen", async () => {
  startPosed(h);
  h.debug.setScreen("paused");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen the press is made on, posed through setScreen",
  );

  await h.tap(PAUSE_KEY);
  const resumed = h.snapshot();
  // Before the assertions, so a check that fails still leaves the picture of what
  // the press actually returned to.
  captureStill(h, "resumed");

  assertEqual(
    resumed.screen,
    "inWave",
    "the screen one frame after P was pressed on the paused screen, which " +
      "specs/controls.md says returns to the live wave",
  );
  assertEqual(
    resumed.phase,
    "live",
    "the sub-phase it returned to, which is the live wave it was paused in " +
      "rather than the ready hold",
  );

  await h.advance(SETTLE_TICKS);
  assertEqual(
    h.snapshot().screen,
    "inWave",
    `the screen ${String(SETTLE_SECONDS)}s later, still with no key pressed — the ` +
      "press must resume the wave rather than blink it",
  );
});
