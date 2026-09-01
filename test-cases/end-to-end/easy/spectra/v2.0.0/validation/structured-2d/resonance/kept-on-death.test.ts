// resonance/kept-on-death — losing a life leaves the meter exactly where it
// stands.
//
// THE RULE. specs/resonance.md: "Losing a life leaves it exactly where it
// stands", beside "Spending a discharge is the only thing that lowers it." The
// obvious wrong model — the meter is part of a life, so a death clears it — is
// exactly what this point exists to catch.
//
// THE LIFE IS LOST THE WAY A PLAYER LOSES ONE. specs/instrumentation.md gives
// `setLives`, but posing the life count down is not losing a life: it would run
// none of the code a build puts on the death path, which is where a meter reset
// would live. So the ship's contact test — one of the three gates `startPosed`
// shuts — is turned back on and one enemy bullet of the OPPOSITE band is dropped
// on the hull, which specs/bands.md makes the fatal case and specs/progression.md
// prices at one life.
//
// THE OPPOSITE BAND IS ALSO WHAT KEEPS THE READING CLEAN. A same-band bullet
// would be absorbed and would ADD `RESONANCE_ABSORB` to the meter, so the one
// contact this scenario runs is the one that costs a life and fills nothing.
//
// THE METER IS READ TWICE, AND BOTH READINGS ARE THE SAME REQUIREMENT. Once in
// the frame the life was paid, and once after `READY_HOLD` has run out and the
// ship is back on its lane, because a build that clears the meter as part of
// putting the ship back would pass the first reading alone. Nothing is on the
// field to move the meter across that hold: the bullet is spent and no drone was
// posed.
//
// WHAT THIS DOES NOT DECIDE. That an opposite-band bullet costs a life is
// `bands`' and `progression`'s; what the ready hold does to the ship is
// `progression`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  READY_HOLD,
  RESONANCE_MAX,
  SHIP_HALF,
  START_LIVES,
} from "../../src/constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  fireAtShip,
  startPosed,
  type Harness,
} from "../harness";

/** The band the ship holds, which `startPosed` poses. */
const SHIP_BAND = "cyan" as const;

/** The band the bullet carries: the opposite, which specs/bands.md makes fatal. */
const FATAL_BAND = "magenta" as const;

/**
 * Where the meter is posed, in meter points: half the ceiling.
 *
 * Clear of `0`, so a build that clears the meter on a death reads a different
 * number, and clear of `RESONANCE_MAX`, so a build that fills it instead does
 * too.
 */
const POSED_METER = RESONANCE_MAX / 2;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: `SHIP_HALF` (`15`, specs/ship.md) and
 * `ENEMY_BULLET_HALF` (`8`, specs/swarm.md).
 */
const TOUCHING = SHIP_HALF + ENEMY_BULLET_HALF;

/**
 * How far above the ship's lane the enemy bullet starts, in logical units.
 *
 * Five times the contact reach, so the bullet is well clear of the hull when it
 * is placed and the life is paid for a contact the FALL produced.
 */
const DROP_ABOVE = 5 * TOUCHING;

/**
 * Frames the fall is allowed.
 *
 * An enemy bullet falls at `ENEMY_BULLET_SPEED` (`320`, specs/swarm.md) times
 * `bulletSpeedScale(1)` (`1`, specs/stages.md) — 3.2 units per frame of the
 * harness's 100 Hz clock — so it enters the hull's reach after
 * `DROP_ABOVE - TOUCHING` = 92 units, inside 29 frames. Forty-five leaves sixteen
 * frames of slack for whichever sub-step a build resolves the contact on.
 */
const FALL_TICKS = 45;

/**
 * Seconds run out after the life is paid, so the ship is back on its lane.
 *
 * `READY_HOLD` (`1.3`) is what specs/progression.md gives the hold, and a fifth
 * of a second past it puts the second reading unambiguously after the respawn
 * whichever frame a build ends the hold on.
 */
const RESPAWN_SECONDS = READY_HOLD + 0.2;

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the meter unchanged through a life loss and the respawn", async () => {
  startPosed(h);
  h.debug.setShipContact(true);
  h.debug.setResonance(POSED_METER);

  const posed = h.snapshot();
  assertEqual(
    posed.ship.band,
    SHIP_BAND,
    "precondition: the band the ship was posed on",
  );
  assertEqual(
    posed.lives,
    START_LIVES,
    "precondition: the lives the run was posed with",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the life loss is measured from",
  );

  await fireAtShip(h, FATAL_BAND, DROP_ABOVE, FALL_TICKS);
  captureStill(h, "kept");

  const lost = h.snapshot();
  assertEqual(
    lost.lives,
    START_LIVES - 1,
    `precondition: the ${FATAL_BAND} bullet cost exactly one life ` +
      `(specs/bands.md, specs/progression.md)`,
  );
  assertCloseTo(
    lost.resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter in the frame a life was lost: unchanged, since losing a life ` +
      `leaves it exactly where it stands (specs/resonance.md)`,
  );

  await h.advanceSeconds(RESPAWN_SECONDS);

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after the READY_HOLD (${READY_HOLD}) put the ship back on its ` +
      `lane: still unchanged (specs/resonance.md)`,
  );
});
