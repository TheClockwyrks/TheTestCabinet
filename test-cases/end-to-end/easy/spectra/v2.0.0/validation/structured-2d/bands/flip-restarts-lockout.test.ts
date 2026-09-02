// bands/flip-restarts-lockout — a second flip restarts the lockout the first began.
//
// specs/bands.md, closing the flip's rules: "A flip made while a lockout is still
// standing restarts that lockout." It is written out because the general rule above
// it — "The flip starts a fire lockout of `FLIP_LOCKOUT` (`0.30`) seconds" — does
// not settle its own boundary: a build that reads "starts" as "starts if none is
// running" leaves the second flip free, and the ship can fire a fifth of a second
// earlier than the specification allows after a double flip. Nothing else on the
// checklist reads it: `bands/flip-instant` and `bands/flip-starts-lockout` take one
// flip from a clear ship, `ship/lockout-blocks-fire` and `ship/lockout-expires`
// take a POSED lockout, and `controls/flip-no-autorepeat` reads a held key rather
// than a second press.
//
// THE ACTION IS DRIVEN, NEVER POSED. specs/instrumentation.md gives `setFireLockout`
// for posing the lockout, and posing it here would grade the surface rather than
// the flip: what is under test is what the SECOND PRESS does to a lockout the FIRST
// PRESS started, so both are real presses through the key `specs/controls.md` binds
// the flip to, and every figure read is the build's own.
//
// THE WAIT IS TWO THIRDS OF THE LOCKOUT, which is the whole of what makes the two
// models different numbers. After 0.20 s of a 0.30 s lockout a conforming build has
// 0.10 s standing; the second flip then reads 0.30 s on a build that restarts it and
// 0.10 s on a build that leaves it alone. The remainder is read first, as the
// sentence's own precondition — "while a lockout is still standing" — so a build
// that had already let the lockout lapse is reported as not having reached the
// scenario rather than failed for the wrong reason. That the remainder is the RIGHT
// remainder is `ship/lockout-expires`'s point and is not re-graded here: only that
// some lockout stands and that it is short of the full figure, which is what lets
// the reading below tell a restart from an untouched countdown.
//
// THE LOCKOUT ALONE IS ASSERTED. Both presses also swap the ship's band, and after
// two of them it is back where it started; that the flip changes the band at all is
// `bands/flip-instant`'s point and is not restated here.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, FLIP_LOCKOUT } from "../constants";
import { assertBetween, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key the flip is delivered on: the first `specs/controls.md` binds to `b`. */
const FLIP_KEY = BINDINGS.b[0];

/** How much of the first lockout is spent before the second flip, as a fraction. */
const SPENT = 2 / 3;

/** Frames of the harness's 100 Hz clock covering that. */
const WAIT_FRAMES = ticksFor(FLIP_LOCKOUT * SPENT);

/**
 * The most the standing lockout may read for the scenario to be the one under test.
 *
 * Four fifths of `FLIP_LOCKOUT`. A conforming build reads about a third of it here,
 * so this is wide slack; what it excludes is a build whose lockout has not moved at
 * all, on which a restart and an untouched countdown are the same number and the
 * reading below would decide nothing.
 */
const STANDING_CEILING = FLIP_LOCKOUT * 0.8;

/**
 * The review item's tolerance on the restarted lockout: within 10%.
 *
 * The same figure `bands/flip-starts-lockout` reads the first lockout to, and wide
 * enough for the one frame of game time `Harness.tap` runs while the key is held —
 * 0.01 s of this 100 Hz clock, which a build that counts the lockout down inside
 * that frame will already have spent. It is nowhere near wide enough to admit the
 * 0.10 s a build that ignored the second flip would be showing.
 */
const LOCKOUT_TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts the lockout back to FLIP_LOCKOUT when a flip lands on a standing one", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the flip action");
  assertEqual(before.ship.lockout, 0, "the lockout the ship was posed with");

  await h.tap(FLIP_KEY);
  await h.advance(WAIT_FRAMES);

  const standing = h.snapshot().ship.lockout;
  assertGreaterThan(
    standing,
    0,
    `precondition: a lockout is still standing ${(FLIP_LOCKOUT * SPENT).toFixed(2)}s ` +
      `into the FLIP_LOCKOUT (${FLIP_LOCKOUT}) the first flip began, which is ` +
      `the situation the rule is about (specs/bands.md; the countdown itself is ` +
      `ship/lockout-expires)`,
  );
  assertBetween(
    standing,
    0,
    STANDING_CEILING,
    `precondition: that standing lockout is short of the full ` +
      `FLIP_LOCKOUT (${FLIP_LOCKOUT}) — a lockout that had not run down at all ` +
      `would read the same whether the second flip restarted it or not`,
  );

  await h.tap(FLIP_KEY);
  const after = h.snapshot();
  captureStill(h, "restarted");

  assertBetween(
    after.ship.lockout,
    FLIP_LOCKOUT * (1 - LOCKOUT_TOLERANCE),
    FLIP_LOCKOUT * (1 + LOCKOUT_TOLERANCE),
    `the seconds of fire lockout standing after a second flip landed on the ` +
      `${standing.toFixed(3)}s left of the first: the whole FLIP_LOCKOUT ` +
      `(${FLIP_LOCKOUT}) again rather than the remainder it found ` +
      `(specs/bands.md)`,
  );
});
