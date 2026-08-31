// resonance/shell-fills-nothing — breaking a Prism's shell leaves the meter
// exactly where it stood.
//
// THE RULE. `specs/resonance.md` names the one exception to the matching-kill
// figure: "Breaking a Prism's shell adds nothing; destroying a Prism's exposed
// core is a matching kill and adds `RESONANCE_KILL`." A shell break is a matching
// shot that DESTROYS A LAYER without destroying the drone (`specs/drones.md`:
// "Breaking the shell leaves the Prism alive with its core exposed"), so a build
// that pays the meter per matching CONTACT rather than per matching KILL is
// exactly what this point catches.
//
// THE METER IS POSED AWAY FROM ZERO, and here that is what makes the check
// two-sided. From `0` a build that pays `RESONANCE_KILL` for the shell reads 4
// and a build that RESETS the meter on the break reads 0 — indistinguishable from
// a correct build. Posed at `POSED_METER`, the correct reading is `POSED_METER`,
// the paying build reads `POSED_METER + RESONANCE_KILL`, and the resetting build
// reads `0`: three different numbers.
//
// THE SHOT IS THE SHELL'S OWN BAND. `specs/drones.md`: with the shell intact the
// exposed layer is the shell, "Broken by | A shot whose effective band matches
// the shell's". The Prism stores cyan, so a cyan shot breaks the shell and
// nothing else on the field can move the meter.
//
// WHAT THIS DOES NOT DECIDE. That the shell breaks and the Prism survives is
// `drones`'; what the break SCORES is `scoring`'s; what the CORE adds is
// `resonance/core-fills`, which is this point's opposite direction — a build that
// pays for neither layer and one that pays for both grade differently.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { FORM_CENTER_X, RESONANCE_KILL, RESONANCE_MAX } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the meter is posed before the break, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (100): clear of `0`, so "unchanged", "paid
 * `RESONANCE_KILL`" (24) and "reset" (0) are three distinct readings.
 */
const POSED_METER = 20;

/**
 * Where the target Prism stands.
 *
 * Mid-field on the ship's own lane, clear of both HUD strips (`FIELD_TOP` 64,
 * `FIELD_BOTTOM` 656) and clear of `SHIP_Y` (600).
 */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * A shell-intact Prism's contact reach is `PRISM_HALF` (28) +
 * `PLAYER_BULLET_HALF` (6) = 34 units of centre separation, so 140 places the
 * bullet four times clear of it and the contact is one the flight produced.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760) a bullet covers 7.6 units per frame of the
 * harness's 100 Hz clock, so it enters the 34-unit reach 106 units up, inside 14
 * frames. Thirty leaves sixteen frames of slack for whichever frame a build
 * resolves the contact on.
 */
const SHOT_FRAMES = 30;

/** Decimal places the meter is read to: whole-number figures, round-off only. */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the meter unchanged when a matching shot breaks a Prism's shell", async () => {
  await startPosed(h);
  await h.debug.setResonance(POSED_METER);
  // Nothing is destroyed by this scenario — the Prism lives on with its core
  // exposed — so the wave still holds a drone and no bystander is needed.
  const prism = await poseDrone(h, "prism", TARGET.x, TARGET.y, {
    band: "cyan",
    shell: true,
  });

  const posed = await h.snapshot();
  assertEqual(
    requireDrone(posed, prism, "the target Prism").shellAlive,
    true,
    "precondition: the Prism's shell stands before the shot",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the break is measured from",
  );

  const shot = await shootDrone(h, prism, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(h, "unchanged");

  assertEqual(
    requireDrone(shot.snapshot, prism, "the target Prism").shellAlive,
    false,
    "precondition: the cyan shot broke the stored-cyan shell (specs/drones.md)",
  );
  assertCloseTo(
    shot.snapshot.resonance,
    POSED_METER,
    METER_DIGITS,
    `the meter after a Prism's shell was broken — unchanged, since breaking a ` +
      `shell adds nothing and a matching kill adds RESONANCE_KILL ` +
      `(${RESONANCE_KILL}) (specs/resonance.md), out of RESONANCE_MAX ` +
      `(${RESONANCE_MAX})`,
  );
});
