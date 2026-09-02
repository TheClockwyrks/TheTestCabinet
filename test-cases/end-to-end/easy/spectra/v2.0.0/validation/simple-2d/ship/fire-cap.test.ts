// Spectra — ship/fire-cap: the player's bullets in flight are capped.
//
// THE RULE. `specs/ship.md` lists the cap among the three gates on firing: a shot
// is allowed only while "fewer than `MAX_PLAYER_BULLETS` (`3`) of the player's
// bullets are in flight". The review item fixes the reading: however long fire is
// held, at most `MAX_PLAYER_BULLETS` friendly bullets are alive at once.
//
// THE HOLD IS LONG ENOUGH TO PRESS THE CAP. `FIRE_INTERVAL` (0.16 s) puts a shot
// in the air six times a second, and a shot leaving the nose crosses the play field
// in about seven tenths of a second, so a conformant cannon has a fourth shot ready
// before the first has left — from roughly half a second into the hold the cap is
// what is deciding, and it goes on deciding for the rest of it. Two seconds is
// thirteen shots' worth of cadence and gives the cap ample opportunity to be
// exceeded.
//
// THE ROSTER IS COUNTED EVERY FRAME, NOT ONCE AT THE END. "At most
// `MAX_PLAYER_BULLETS` alive AT ONCE" is a claim about every instant of the hold,
// and a build that overshoots to four and is back to three a moment later is
// exactly the build this point exists to catch. Sampling every frame of this
// suite's 120 Hz clock is finer than the 19.2 frames between two conformant shots,
// so no excess can appear and clear between two samples.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. The HIGH-WATER MARK, against the cap. How
// often shots leave is `ship/fire-cadence`'s point and is not restated here: the
// bound is one-sided, so a build with a slower cadence that never reaches three
// still passes this point and loses that one. The one thing checked in the other
// direction is that the hold fired at all, so that a cannon which produced nothing
// cannot satisfy a ceiling by never approaching it — that a press fires is
// `ship/fire-spawns-bullet`'s point, and this is only the scenario's precondition.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters — so every bullet
// counted is one this hold fired — shuts the wave's three gates, and leaves the
// cooldown and the lockout at zero, so nothing but the cap can hold a shot back.

import { afterEach, beforeEach, it } from "vitest";
import {
  BINDINGS,
  FIRE_INTERVAL,
  MAX_PLAYER_BULLETS,
} from "../constants";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  playerBullets,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key the fire action is held on: the first the build bound to `a`. */
const FIRE_KEY = BINDINGS.a[0];

/** How long fire is held: thirteen shots' worth of `FIRE_INTERVAL`. */
const HOLD_SECONDS = 2;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * The fewest bullets the hold must have put in the air for the ceiling to mean
 * anything.
 *
 * ONE — the scenario's precondition and not a second requirement. A cannon that
 * fires nothing trivially satisfies any cap, and it is `ship/fire-spawns-bullet`
 * that grades whether a press fires; this only keeps that build from passing here
 * as well.
 */
const MIN_IN_FLIGHT = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("never holds more than MAX_PLAYER_BULLETS of the player's bullets at once", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(before.ship.cooldown, 0, "no fire cooldown stands");
  assertEqual(before.ship.lockout, 0, "and no fire lockout stands");
  assertLength(
    playerBullets(before),
    0,
    "the field holds none of the player's bullets before the hold",
  );

  let peak = 0;
  h.hold(FIRE_KEY);
  try {
    for (let tick = 0; tick < HOLD_TICKS; tick += 1) {
      await h.advance(1);
      peak = Math.max(peak, playerBullets(h.snapshot()).length);
    }
    // Before the assertions, so a check that fails still leaves the picture of
    // the bullets the hold had in the air at the end of it.
    captureStill(h, "capped");
  } finally {
    h.release(FIRE_KEY);
  }

  assertGreaterThanOrEqual(
    peak,
    MIN_IN_FLIGHT,
    `the player's bullets the ${String(HOLD_SECONDS)}s hold ever had in the ` +
      "air at once — a cannon that fires nothing cannot be graded against the cap",
  );
  assertLessThanOrEqual(
    peak,
    MAX_PLAYER_BULLETS,
    "the most of the player's bullets alive at once over a " +
      `${String(HOLD_SECONDS)}s hold, MAX_PLAYER_BULLETS ` +
      `(${String(MAX_PLAYER_BULLETS)}), where the cadence offers one every ` +
      `FIRE_INTERVAL (${String(FIRE_INTERVAL)}) (specs/ship.md)`,
  );
});
