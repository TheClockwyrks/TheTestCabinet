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
// THE ABSORB IS REAL, NOT POSED. Nothing here removes the bullet or writes the
// meter: the bullet is placed above the hull carrying the band the shield takes,
// and the build's own contact and band rules decide the rest.
// `setShipContact(true)` puts back the one world gate `startPosed` shuts, because
// a contact is precisely what this item's requirement rests on.
//
// WHY THE EVENT IS "GONE AND UNHARMED". `specs/bands.md` gives an enemy bullet
// two outcomes at the hull, and BOTH take it off the roster: a same-band bullet
// is absorbed with the ship unharmed, an opposite-band one costs a life. So the
// event this check stops on is the bullet leaving the roster with the run's lives
// still whole. The budget stops the sweep well before the bullet could have
// fallen past the ship to `FIELD_BOTTOM`, so a bullet culled off the field cannot
// be mistaken for one absorbed.
//
// WHAT THIS DOES NOT DECIDE. That the bullet is absorbed rather than fatal is
// `bands/shield-absorbs`; what a MATCHING KILL adds is `resonance/kill-fills`.
// This point reads the meter and the meter alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  RESONANCE_ABSORB,
  RESONANCE_MAX,
  START_LIVES,
  bulletSpeedScale,
} from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  findBullet,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";
import { poseEnemyBulletAbove } from "./wave";

/**
 * Where the meter is posed before the absorb, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): far enough above `0` that adding, setting
 * and filling-to-a-fraction all read differently, and far enough below the
 * ceiling that `POSED_METER + RESONANCE_ABSORB` (`26`) is nowhere near it.
 */
const POSED_METER = 20;

/**
 * How far above the ship the enemy bullet is placed, in logical units.
 *
 * Geometry, not a tolerance. The hull's contact reach against an enemy bullet is
 * `SHIP_HALF` (`15`) + `ENEMY_BULLET_HALF` (`8`) = `23` units of centre
 * separation, so `120` starts the bullet five times clear of it and the contact
 * the meter reads is one the fall produced rather than one the placement did.
 */
const DROP_ABOVE = 120;

/** The speed the bullet falls at on stage 1 (specs/stages.md, specs/drones.md). */
const FALL_SPEED = ENEMY_BULLET_SPEED * bulletSpeedScale(1);

/**
 * Frames the fall is given to reach the hull.
 *
 * The time to fall the whole `DROP_ABOVE` at `FALL_SPEED` — geometry again — plus
 * two frames for the frame the bullet was placed on and for whichever frame a
 * build resolves the contact on. Contact lands sooner than the whole fall, since
 * the two half-extents meet before the centres do, which is why this budget
 * cannot run long enough for a bullet that passed straight through to reach
 * `FIELD_BOTTOM` (`656`) and be culled.
 */
const FALL_FRAMES = ticksFor(DROP_ABOVE / FALL_SPEED) + 2;

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

afterEach(() => {
  h?.dispose();
});

it("adds exactly RESONANCE_ABSORB when the hull absorbs a same-band bullet", async () => {
  // An empty, quiet, live wave: no drone, no other bullet and no burst, so the
  // only thing that can move the meter in this window is the absorb.
  startPosed(h);
  // The one world gate this item's requirement rests on: without it the hull runs
  // no contact test and there is no absorb to read.
  h.debug.setShipContact(true);
  h.debug.setResonance(POSED_METER);

  const posed = h.snapshot();
  assertEqual(posed.ship.band, "cyan", "precondition: the band the ship holds");
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the absorb is measured from",
  );

  const bullet = poseEnemyBulletAbove(h, posed.ship.band, DROP_ABOVE);
  const swept = await h.until(
    (s) => findBullet(s, bullet) === null && s.lives === START_LIVES,
    { maxFrames: FALL_FRAMES },
  );
  captureStill(h, "filled");

  assertEqual(
    swept.hit,
    true,
    `precondition: the ${posed.ship.band} bullet dropped ${DROP_ABOVE} units ` +
      `above the hull was absorbed — off the roster with all ${START_LIVES} ` +
      `lives intact, and far above FIELD_BOTTOM (${FIELD_BOTTOM}) — inside the ` +
      `${FALL_FRAMES} frames its fall takes (specs/bands.md)`,
  );
  assertCloseTo(
    swept.snapshot.resonance,
    POSED_METER + RESONANCE_ABSORB,
    METER_DIGITS,
    `the meter after one absorbed bullet of the ship's own band: ` +
      `${POSED_METER} + RESONANCE_ABSORB (${RESONANCE_ABSORB}) ` +
      `(specs/resonance.md), out of RESONANCE_MAX (${RESONANCE_MAX})`,
  );
});
