// resonance/absorb-fills — absorbing one same-band enemy bullet raises the meter
// by exactly `RESONANCE_ABSORB`.
//
// THE RULE. `specs/resonance.md` fills the meter from exactly two events, and
// this is the first of them: "The hull absorbs an enemy bullet of the ship's own
// band | `RESONANCE_ABSORB` (`6`)". `specs/bands.md` says which bullet that is —
// "The same band as the ship's | The bullet is absorbed and leaves the roster,
// and the ship is unharmed" — so a cyan bullet dropped onto the cyan ship is the
// absorbing case, reached with nothing else on the field that could move the
// meter.
//
// THE METER IS POSED AWAY FROM ZERO, and that is the point of the check rather
// than a detail. From `0` a build that ADDS `RESONANCE_ABSORB` and a build that
// SETS the meter to `RESONANCE_ABSORB` read the same number, and so does a build
// that fills the meter to some fixed fraction on any absorb. Posed at
// `POSED_METER`, each of those reads a different number, so a failure names which
// wrong model the build implemented. `POSED_METER` also leaves the ceiling far
// out of reach, so nothing here is decided by the cap `resonance/caps-at-max`
// grades.
//
// WHAT THIS DOES NOT DECIDE. That the bullet is absorbed rather than fatal is
// `bands/shield-absorbs`; what a MATCHING KILL adds is `resonance/kill-fills`.
// This point reads the meter and the meter alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { RESONANCE_ABSORB, RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  fireAtShip,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the meter is posed before the absorb, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (100): far enough above `0` that adding, setting and
 * filling-to-a-fraction all read differently, and far enough below the ceiling
 * that `POSED_METER + RESONANCE_ABSORB` (26) is nowhere near the cap.
 */
const POSED_METER = 20;

/**
 * How far above the ship the enemy bullet is placed, in logical units.
 *
 * The hull's contact reach against an enemy bullet is `SHIP_HALF` (15) +
 * `ENEMY_BULLET_HALF` (8) = 23 units of centre separation, so 120 starts the
 * bullet five times clear of it and the contact the meter reads is one the fall
 * produced rather than one the placement did.
 */
const DROP_ABOVE = 120;

/**
 * Frames the fall is allowed.
 *
 * An enemy bullet falls at `ENEMY_BULLET_SPEED` (320) times `bulletSpeedScale(1)`
 * (1) — 3.2 units per frame of the harness's 100 Hz clock — so it enters the
 * hull's reach 97 units down, inside 31 frames. Forty-five leaves fourteen frames
 * of slack and still ends with the bullet at y = 624, above `FIELD_BOTTOM` (656):
 * inside this sweep a bullet cannot leave the roster by falling off the field.
 */
const DROP_FRAMES = 45;

/**
 * Decimal places the meter is read to.
 *
 * `specs/resonance.md` states the meter's figures as whole numbers, so the only
 * slack allowed here is the round-off of a build that carries the meter as a
 * fraction of `RESONANCE_MAX` and reports it scaled: 5e-7 covers that and nothing
 * a real accounting error could hide behind.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds exactly RESONANCE_ABSORB when the hull absorbs a same-band bullet", async () => {
  await startPosed(h);
  // The ship's contact test is one of the three world gates `startPosed` shuts,
  // and this point's requirement is precisely a contact, so it is turned back on.
  await h.debug.setShipContact(true);
  await h.debug.setResonance(POSED_METER);

  const posed = await h.snapshot();
  assertEqual(posed.ship.band, "cyan", "precondition: the band the ship holds");
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the absorb is measured from",
  );

  const shot = await fireAtShip(h, "cyan", {
    above: DROP_ABOVE,
    maxFrames: DROP_FRAMES,
  });
  await captureStill(h, "filled");

  assertEqual(
    shot.hit,
    true,
    "precondition: the bullet reached the hull inside its fall",
  );
  assertCloseTo(
    shot.snapshot.resonance,
    POSED_METER + RESONANCE_ABSORB,
    METER_DIGITS,
    `the meter after one absorbed bullet of the ship's own band: ` +
      `${POSED_METER} + RESONANCE_ABSORB (${RESONANCE_ABSORB}) ` +
      `(specs/resonance.md), out of RESONANCE_MAX (${RESONANCE_MAX})`,
  );
});
