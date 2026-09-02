// resonance/shell-fills-nothing — breaking a Prism's shell leaves the meter
// exactly where it stood.
//
// THE RULE. specs/resonance.md names the one exception to the matching-kill
// figure: "Breaking a Prism's shell adds nothing; destroying a Prism's exposed
// core is a matching kill and adds `RESONANCE_KILL`." A shell break is a matching
// shot that destroys a LAYER without destroying the drone (specs/drones.md:
// breaking the shell leaves the Prism alive with its core exposed), so a build
// that pays the meter per matching CONTACT rather than per matching KILL is
// exactly what this point catches.
//
// THE METER IS POSED AWAY FROM ZERO, and here that is what makes the check
// two-sided. From `0` a build that pays `RESONANCE_KILL` for the shell reads 4
// and a build that RESETS the meter on the break reads 0 — indistinguishable from
// a correct build. Posed at {@link POSED_METER}, the correct reading is
// `POSED_METER`, the paying build reads `POSED_METER + RESONANCE_KILL`, and the
// resetting build reads `0`: three different numbers.
//
// THE SHOT IS THE SHELL'S OWN BAND. specs/drones.md: with the shell intact the
// exposed layer is the shell, broken by a shot whose effective band matches the
// shell's. The Prism stores cyan, so a cyan shot breaks the shell and nothing
// else on the field can move the meter.
//
// NO BYSTANDER STANDS HERE, and the reason is the requirement itself: this
// scenario destroys no drone — the Prism lives on with its core exposed — so the
// wave still holds a drone and no stage can clear underneath the reading.
//
// WHAT THIS DOES NOT DECIDE. That the shell breaks and the Prism survives is
// `drones`'; what the break SCORES is `scoring`'s; what the CORE adds is
// `resonance/core-fills`, which is this point's opposite direction — a build that
// pays for neither layer and one that pays for both grade differently.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  PRISM_HALF,
  RESONANCE_KILL,
  RESONANCE_MAX,
} from "../constants";
import { assertCloseTo, assertEqual } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/**
 * Where the meter is posed before the break, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): clear of `0`, so "unchanged", "paid
 * `RESONANCE_KILL`" (24) and "reset" (0) are three distinct readings.
 */
const POSED_METER = 20;

/**
 * Where the target Prism stands, in logical units.
 *
 * Mid-field on the ship's own lane, well inside the play field on both axes (`y`
 * in `[64, 656]`, specs/field.md) and far above the ship's lane at `SHIP_Y`
 * (`600`).
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/** The Prism's stored band, which specs/drones.md makes the shell's. */
const SHELL_BAND = "cyan" as const;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: a shell-intact Prism's `PRISM_HALF` (`28`,
 * specs/drones.md) and `PLAYER_BULLET_HALF` (`6`, specs/ship.md).
 */
const TOUCHING = PRISM_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Four times the contact reach, so the bullet starts well clear of the Prism and
 * the break is one the FLIGHT produced rather than one the placement did.
 */
const SHOT_BELOW = 4 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * Derived rather than chosen. `SHOT_BELOW - TOUCHING` (102) units of climb bring
 * the bullet inside the contact reach, and `PLAYER_BULLET_SPEED` (`760`,
 * specs/ship.md) is what specs/ship.md gives it to climb at, so the contact is
 * inside the frames that speed needs to close that gap. Twice that is slack for
 * whichever sub-step a build resolves the contact on, and nothing else.
 */
const FLIGHT_TICKS =
  2 * ticksFor((SHOT_BELOW - TOUCHING) / PLAYER_BULLET_SPEED);

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the meter unchanged when a matching shot breaks a Prism's shell", async () => {
  startPosed(h);
  h.debug.setResonance(POSED_METER);
  const prism = poseDrone(h, "prism", TARGET_X, TARGET_Y, {
    band: SHELL_BAND,
    shell: true,
  });

  const posed = h.snapshot();
  assertEqual(
    droneById(posed, prism)?.shellAlive,
    true,
    "precondition: the Prism's shell stands before the shot",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the break is measured from",
  );

  await fireAt(h, TARGET_X, TARGET_Y, SHELL_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "unchanged");

  const after = h.snapshot();
  assertEqual(
    droneById(after, prism)?.shellAlive,
    false,
    `precondition: the ${SHELL_BAND} shot broke the stored-${SHELL_BAND} shell ` +
      `and left the Prism standing (specs/drones.md)`,
  );
  assertCloseTo(
    after.resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after a Prism's shell was broken — unchanged, since breaking a ` +
      `shell adds nothing and a matching kill adds RESONANCE_KILL ` +
      `(${RESONANCE_KILL}) (specs/resonance.md), out of RESONANCE_MAX ` +
      `(${RESONANCE_MAX})`,
  );
});
