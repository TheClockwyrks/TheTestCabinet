// Spectra — controls/flip-shift-right: pressing `ShiftRight` flips the ship's band.
//
// THE RULE. `specs/controls.md` binds the `b` action — "Flips the ship's band." —
// to `KeyF`, `ShiftLeft` and `ShiftRight`, reads `b` as a press EDGE, and lists it
// among the actions the `inWave` screen reads. `specs/bands.md` says the flip
// changes the ship's band to THE OPPOSITE ONE, in the frame the action is
// delivered. This point decides one third of that binding: that the physical key
// `ShiftRight` is one of the keys which drives it. `controls/flip-f` and `controls/flip-shift-left` decide the other two, so
// a build that wired some and not all loses exactly the points it missed.
//
// WHY THE KEY IS PRESSED TWICE. Once is not enough to tell a flip from a latch: a
// build whose `ShiftRight` writes `magenta` rather than the opposite band passes a
// single press and is not flipping anything. The ship starts each run on `cyan`
// (`specs/bands.md`), so the two presses run cyan → magenta → cyan, and every wrong
// model reads as a different band — a build that does nothing stays on cyan, a
// build that latches magenta stays there, and only a build that takes the opposite
// band each time lands back on cyan. A standing lockout is no obstacle to the
// second press: `specs/bands.md` says a flip made while a lockout stands RESTARTS
// the lockout, so nothing blocks a flip.
//
// WHAT IS NOT ASSERTED. The `FLIP_LOCKOUT` the flip starts is
// `bands/flip-starts-lockout`'s and what it costs the cannon is
// `ship/lockout-blocks-fire`'s; that the change is instant is
// `bands/flip-instant`'s; the frame the polarity indicator follows it on is
// `screens/hud-polarity-indicator`'s. Restating any of them would cost one build
// two points for one fault.
//
// THE PRESS IS THE ONE A PLAYER MAKES, AND IT IS DELIBERATELY NOT THE SHORTEST ONE.
// `holdFor(h, KEY, 1)` presses the key, runs the frame that delivers it, and
// releases it — so the key is genuinely DOWN across the update, the way it is for
// the several frames a real thumb rests on it. That matters for the accounting.
// The engine offers two readings of the same key, `pressed` (the armed edge) and
// `value` (down this frame), and `specs/controls.md` requires `b` to be read as the
// edge. A build that reads it as the value is wrong, and it is wrong at exactly one
// point: `controls/flip-no-autorepeat`, which holds the key for a whole second and
// counts the flips. Pressing the key here for less than a frame would fail that
// build a second, third and fourth time, on three points that are only about which
// keys are bound — one fault charged four times. So this point presses the key the
// way a player does, and grades only what it claims to grade.
//
// THE KEY IS A REAL ONE. The event is a `KeyboardEvent`-shaped one dispatched at
// the engine's own event target, which the engine resolves exactly as it resolves a
// player's key (the engine's own `engine/input.md`), so the whole path from a
// physical key to a changed band — the registration of `b` against its keys
// included — is exercised. The code below is the LITERAL `specs/controls.md` states
// rather than `BINDINGS.b[…]`: that table is the build's own copy of the very thing
// this point decides, and reading it would let a build which bound the wrong key
// agree with itself and pass.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so no contact, no inversion and no drone can touch the band while
// the presses land. The ship's OWN band is never swapped by an inversion in any
// case (`specs/bands.md`), and none is running here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdFor,
  startPosed,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the `b` action to, written out as it states it. */
const KEY = "ShiftRight";

/** The band a run — and `startPosed` — puts the ship on (`specs/bands.md`). */
const START_BAND = "cyan";

/** The only other band there is, which is what "the opposite" means here. */
const OPPOSITE_BAND = "magenta";

/**
 * How many frames the key is held down for one press.
 *
 * ONE, the shortest press that leaves the key down across a whole update.
 * `specs/bands.md` makes the change instant — "the ship holds the other band in
 * the frame the action is delivered" — so one frame is all a conforming build
 * needs, and holding no longer is what keeps this point from grading how many
 * times a HELD key acts. That is `controls/flip-no-autorepeat`'s verdict.
 */
const PRESS_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the ship to the opposite band on each Right Shift press", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(before.ship.band, START_BAND, "the ship starts on cyan");

  await holdFor(h, KEY, PRESS_TICKS);
  // Before the assertions, so a check that fails still leaves the picture of the
  // ship the first press left behind.
  captureStill(h, "flipped");
  assertEqual(
    h.snapshot().ship.band,
    OPPOSITE_BAND,
    `the ship's band one frame after Right Shift was pressed, from ` +
      `${START_BAND} — a flip takes the OPPOSITE band (specs/bands.md)`,
  );

  await holdFor(h, KEY, PRESS_TICKS);
  assertEqual(
    h.snapshot().ship.band,
    START_BAND,
    `the ship's band after a second Right Shift, which must come back to ` +
      `${START_BAND}: the action flips rather than latching (specs/bands.md)`,
  );
});
