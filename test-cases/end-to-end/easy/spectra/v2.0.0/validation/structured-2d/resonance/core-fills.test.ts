// resonance/core-fills — destroying a Prism's exposed core raises the meter by
// `RESONANCE_KILL`.
//
// THE RULE. specs/resonance.md, the same sentence that exempts the shell:
// "Breaking a Prism's shell adds nothing; destroying a Prism's exposed core is a
// matching kill and adds `RESONANCE_KILL`." This is the other direction of
// `resonance/shell-fills-nothing`: a build that pays nothing for either layer
// fails here and passes there, and a build that pays for both fails there and
// passes here, so the pair cannot be satisfied by one blanket rule.
//
// THE PRISM IS POSED WITH ITS SHELL ALREADY BROKEN, through `setDroneShell`,
// rather than broken with a first shot. specs/drones.md makes the core the
// exposed layer exactly when the shell is gone, and that is the whole
// precondition this point needs; firing a shell-breaking shot first would put a
// second matching contact inside a scenario that is measuring what ONE kill adds.
//
// THE SHOT IS THE CORE'S BAND, WHICH IS THE OPPOSITE OF THE STORED ONE.
// specs/drones.md: the shell's band is the Prism's stored band and the core's is
// always the opposite, and a shell-broken Prism is broken by a shot whose
// effective band matches the core's. The Prism stores cyan, so the magenta shot
// is the matching one — which also means a build that reads the stored band
// straight through, ignoring the shell swap, destroys nothing here and reads the
// meter unmoved.
//
// WHAT THIS DOES NOT DECIDE. That the core falls to a matching shot at all is
// `bands`' and `drones`'; what the core kill SCORES is `scoring`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  PRISM_CORE_HALF,
  RESONANCE_KILL,
  RESONANCE_MAX,
} from "../constants";
import { assertCloseTo, assertEqual, assertUndefined } from "../assert";
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
 * Where the meter is posed before the kill, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): clear of `0`, so adding and setting read
 * differently, and clear of the ceiling, so `POSED_METER + RESONANCE_KILL` (24)
 * is nowhere near the cap.
 */
const POSED_METER = 20;

/**
 * Where the target Prism stands, in logical units.
 *
 * Mid-field on the ship's own lane, well inside the play field on both axes
 * (`y` in `[64, 656]`, specs/field.md), far above the ship's lane at `SHIP_Y`
 * (`600`).
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/** The Prism's stored band, which specs/drones.md makes the SHELL's. */
const STORED_BAND = "cyan" as const;

/** The core's band: always the opposite of the stored one (specs/drones.md). */
const CORE_BAND = "magenta" as const;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: a shell-broken Prism's `PRISM_CORE_HALF`
 * (`13`, specs/drones.md) and `PLAYER_BULLET_HALF` (`6`, specs/ship.md).
 */
const TOUCHING = PRISM_CORE_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the contact reach, so the bullet starts well clear of the core and
 * the kill the meter reads is one the FLIGHT produced rather than one the
 * placement did.
 */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * Derived rather than chosen. `SHOT_BELOW - TOUCHING` (114) units of climb bring
 * the bullet inside the contact reach, and `PLAYER_BULLET_SPEED` (`760`) is what
 * specs/ship.md gives it to climb at, so the contact is inside the frames that
 * speed needs to close that gap. Twice that is slack for whichever sub-step a
 * build resolves the contact on, and nothing else.
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

it("adds RESONANCE_KILL when a matching shot destroys a Prism's exposed core", async () => {
  startPosed(h);
  h.debug.setResonance(POSED_METER);
  const prism = poseDrone(h, "prism", TARGET_X, TARGET_Y, {
    band: STORED_BAND,
    shell: false,
  });

  const posed = h.snapshot();
  assertEqual(
    droneById(posed, prism)?.shellAlive,
    false,
    "precondition: the Prism's core is the exposed layer",
  );
  assertCloseTo(
    posed.resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the core kill is measured from",
  );

  await fireAt(h, TARGET_X, TARGET_Y, CORE_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "filled");

  const after = h.snapshot();
  assertUndefined(
    droneById(after, prism),
    `precondition: the ${CORE_BAND} shot destroyed the exposed core of the ` +
      `stored-${STORED_BAND} Prism (specs/drones.md)`,
  );
  assertCloseTo(
    after.resonance,
    POSED_METER + RESONANCE_KILL,
    METER_DIGITS,
    `the meter after a Prism's exposed core was destroyed: ${POSED_METER} + ` +
      `RESONANCE_KILL (${RESONANCE_KILL}) (specs/resonance.md), out of ` +
      `RESONANCE_MAX (${RESONANCE_MAX})`,
  );
});
