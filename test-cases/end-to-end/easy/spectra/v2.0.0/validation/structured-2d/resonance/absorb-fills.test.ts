// resonance/absorb-fills — absorbing one same-band enemy bullet raises the meter
// by exactly `RESONANCE_ABSORB`.
//
// THE RULE. specs/resonance.md fills the meter from exactly two events, and this
// is the first of them: "The hull absorbs an enemy bullet of the ship's own band
// | `RESONANCE_ABSORB` (`6`)". specs/bands.md says which bullet that is — "The
// same band as the ship's | The bullet is absorbed and leaves the roster, and the
// ship is unharmed" — so a cyan bullet dropped onto the cyan ship is the
// absorbing case, reached with nothing else on the field that could move the
// meter.
//
// THE METER IS POSED AWAY FROM ZERO, and that is the point of the check rather
// than a detail. From `0` a build that ADDS `RESONANCE_ABSORB` and a build that
// SETS the meter to `RESONANCE_ABSORB` read the same number, and so does a build
// that fills the meter to some fixed fraction on any absorb. Posed at
// {@link POSED_METER}, each of those reads a different number, so a failure names
// which wrong model the build implemented. It also leaves the ceiling far out of
// reach, so nothing here is decided by the cap `resonance/caps-at-max` grades.
//
// THE WORLD IS THE SHIP AND ONE BULLET. `startPosed` empties the three rosters
// and shuts the three world gates; exactly one is turned back on — the ship's
// contact test — because an absorb IS a contact and with the gate shut nothing
// would happen at all. Nothing else is on the field, so the meter can only move
// for the absorb under test.
//
// WHAT THIS DOES NOT DECIDE. That the bullet is absorbed rather than fatal is
// `bands/shield-absorbs`; what a MATCHING KILL adds is `resonance/kill-fills`.
// This point reads the meter and the meter alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_HALF,
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  RESONANCE_ABSORB,
  RESONANCE_MAX,
  SHIP_HALF,
  START_LIVES,
  bulletSpeedScale,
} from "../../src/constants";
import { assertCloseTo, assertEqual, assertUndefined } from "../assert";
import {
  SHIP_LANE_Y,
  bulletById,
  captureStill,
  createHarness,
  fireAtShip,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** The band the ship holds, which `startPosed` poses, and the bullet's with it. */
const SHIELDED_BAND = "cyan" as const;

/**
 * Where the meter is posed before the absorb, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): far enough above `0` that adding, setting
 * and filling-to-a-fraction all read differently, and far enough below the
 * ceiling that `POSED_METER + RESONANCE_ABSORB` (26) is nowhere near the cap.
 */
const POSED_METER = 20;

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
 * is placed and the absorb the meter reads is one the FALL produced.
 */
const DROP_ABOVE = 5 * TOUCHING;

/**
 * Frames the fall is allowed.
 *
 * An enemy bullet falls at `ENEMY_BULLET_SPEED` (`320`, specs/swarm.md) times
 * `bulletSpeedScale(1)` (`1`, specs/stages.md) — 3.2 units per frame of the
 * harness's 100 Hz clock — so it enters the hull's reach after
 * `DROP_ABOVE - TOUCHING` = 92 units, inside 29 frames. Forty-five leaves sixteen
 * frames of slack for whichever sub-step a build resolves the contact on, and
 * still ends {@link CLEARANCE} units above `FIELD_BOTTOM`: inside this sweep a
 * bullet cannot leave the roster by falling off the field, so leaving it means
 * the hull took it.
 */
const FALL_TICKS = 45;

/**
 * How far a bullet that fell straight past the ship would still be from the edge
 * that removes it, in logical units (specs/field.md: an enemy bullet whose centre
 * falls below `FIELD_BOTTOM` is removed).
 */
const CLEARANCE =
  FIELD_BOTTOM -
  (SHIP_LANE_Y -
    DROP_ABOVE +
    seconds(FALL_TICKS) * ENEMY_BULLET_SPEED * bulletSpeedScale(1));

/**
 * Decimal places the meter is read to.
 *
 * specs/resonance.md states the meter's figures as whole numbers, so the only
 * slack allowed here is the round-off of a build that carries the meter as a
 * fraction of `RESONANCE_MAX` and reports it scaled: 5e-7 covers that and nothing
 * a real accounting error could hide behind.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly RESONANCE_ABSORB when the hull absorbs a same-band bullet", async () => {
  startPosed(h);
  h.debug.setShipContact(true);
  h.debug.setResonance(POSED_METER);

  const posed = h.snapshot();
  assertEqual(
    posed.ship.band,
    SHIELDED_BAND,
    "precondition: the band the ship was posed on",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the absorb is measured from",
  );

  const bulletId = await fireAtShip(h, SHIELDED_BAND, DROP_ABOVE, FALL_TICKS);
  captureStill(h, "filled");

  const after = h.snapshot();
  assertEqual(
    after.lives,
    START_LIVES,
    `precondition: the ${SHIELDED_BAND} bullet was absorbed rather than fatal ` +
      `(specs/bands.md)`,
  );
  assertUndefined(
    bulletById(after, bulletId),
    `precondition: the same-band bullet left the roster, absorbed by the hull ` +
      `with ${CLEARANCE} units still between it and FIELD_BOTTOM ` +
      `(specs/bands.md)`,
  );
  assertCloseTo(
    after.resonance,
    POSED_METER + RESONANCE_ABSORB,
    METER_DIGITS,
    `the meter after one absorbed bullet of the ship's own band: ` +
      `${POSED_METER} + RESONANCE_ABSORB (${RESONANCE_ABSORB}) ` +
      `(specs/resonance.md), out of RESONANCE_MAX (${RESONANCE_MAX})`,
  );
});
