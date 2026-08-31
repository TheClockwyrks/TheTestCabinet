// Meltdown — instrumentation/tower-thermal-gate-leaves-the-guns: thermal off
// leaves the guns firing.
//
// `specs/instrumentation.md`, the gate table, on `thermalEnabled`: "Off, an
// emitter's heat holds exactly where it was posed while it goes on acquiring
// targets, firing at its rate, and dealing its damage at that pinned heat."
//
// THE READING IS ONE NUMBER THAT CARRIES BOTH CLAIMS. `specs/combat.md` fixes the
// rate — "Each time the accumulator reaches `1 / fireRate` ... one shot resolves"
// with the first shot one whole interval after the target is acquired — and the
// damage — "One shot removes `baseDamage(level) * heatMultiplier(H, redline)`
// from its target's hp, where `H` is the emitter's heat at the moment the shot
// resolves". So over a window of known length the hp removed is the number of
// intervals it holds times the per-shot figure, and a build whose rate is wrong
// or whose damage is wrong lands somewhere else.
//
// THE PIN IS WHAT MAKES THAT ONE NUMBER POSSIBLE. `H` is read at the moment each
// shot resolves, so on a free tower the multiplier climbs shot by shot as the
// `heatPerShot` lands and the total is a sum of different figures. Held at `40`,
// every shot in the window is worth exactly the same, and the expectation is a
// multiplication. That the heat really did hold is asserted as this point's
// precondition rather than as its verdict: the pin itself is
// `tower-thermal-gate`'s.
//
// THE WINDOW IS `2.75` SECONDS, WHICH IS FIVE INTERVALS AND A QUARTER. The Arc
// fires at `2.0` a second (`specs/towers.md`), so shots land at `0.5` through
// `2.5` and the window closes a quarter of an interval short of the sixth. That
// quarter — thirty frames of the clock this suite runs — is the margin: nothing
// about where the window ends can add or drop a shot.
//
// THE HEAT MULTIPLIER IS RESTATED HERE FROM `specs/heat.md` rather than called
// off the build's figure table, because an expectation evaluated by the same
// function the build evaluates would agree with a build that changed the curve.
// `40` against the Arc's redline of `80` is half way up the ramp, so the
// multiplier is `MIN + (MAX - MIN) * 0.25`, a figure that is neither of the two
// ends and cannot be reached by a build that ignored the heat and used a
// constant.
//
// THE MARK IS UNKILLABLE AND STILL, so the drive is a subtraction rather than a
// death and no re-acquisition interrupts the fire clock.

import { afterEach, beforeEach, it } from "vitest";
import { MAX_HEAT_MULT, MIN_HEAT_MULT, TOWER_DEFS } from "../../src/constants";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
} from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import { poseMarkFor, QUIET_SITE, readTower } from "./ground";

/** The emitter posed, and the heat it is pinned at. */
const TYPE = "arc";
const PINNED_HEAT = 40;

/** The Arc's figures, from `specs/towers.md`'s table. */
const ARC = TOWER_DEFS[TYPE];
const FIRE_RATE = ARC.kind === "emitter" ? ARC.fireRate : 0;
const BASE_DAMAGE = ARC.kind === "emitter" ? ARC.baseDamage : 0;
const REDLINE = ARC.kind === "emitter" ? ARC.redline : 1;

/**
 * `heatMultiplier(H, R)` as `specs/heat.md` states it: quadratic to the redline,
 * then flat across the plateau to `100`.
 */
function heatMultiplierOf(heat: number, redline: number): number {
  const ramp = Math.min(heat, redline) / redline;
  return MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * ramp * ramp;
}

/**
 * The window driven, in seconds: five whole fire intervals plus a quarter of one.
 *
 * Geometry rather than a tolerance — it says how long the drive runs. The quarter
 * interval is what keeps the shot count away from a boundary at either end.
 */
const WINDOW = 5.25 / FIRE_RATE;

/** How many shots `specs/combat.md`'s fire clock resolves in that window. */
const SHOTS = Math.floor(WINDOW * FIRE_RATE);

/** The hp those shots remove, at the pinned heat. */
const EXPECTED_DAMAGE =
  SHOTS * BASE_DAMAGE * heatMultiplierOf(PINNED_HEAT, REDLINE);

/**
 * How closely the hp removed must match, in decimal places.
 *
 * The expectation is a product of three figures `specs/` fixes, and a build that
 * computes them the same way arrives at the identical float; three places is
 * eight orders above that error and four orders below the whole `6.8` hp one
 * shot's worth of difference would show.
 */
const DAMAGE_DIGITS = 3;

/** How far the pinned heat may sit from where it was posed, as a precondition. */
const PINNED_TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires at its rate and removes the pinned heat's damage on every shot", async () => {
  assertEqual(
    SHOTS,
    5,
    "precondition: the window holds five whole fire intervals",
  );
  assertGreaterThan(
    EXPECTED_DAMAGE,
    0,
    "precondition: the specification's own figure for this drive is not zero",
  );

  startRun(h);
  h.debug.addTower(TYPE, QUIET_SITE.col, QUIET_SITE.row, 0);
  const gun = h.snapshot().towers[0].id;
  h.debug.setTowerThermal(gun, false);
  h.debug.setTowerHeat(gun, PINNED_HEAT);
  poseMarkFor(h, QUIET_SITE);

  await h.advance(ticksFor(WINDOW));
  captureStill(h, "firing");
  const after = readTower(h.snapshot(), gun, "the pinned gun after the window");

  assertLessThan(
    Math.abs(after.heat - PINNED_HEAT),
    PINNED_TOLERANCE,
    "precondition: the pin held the heat every shot was scaled by",
  );
  assertEqual(after.firing, true, "the pinned tower is still firing");
  assertCloseTo(
    after.damageDealt,
    EXPECTED_DAMAGE,
    DAMAGE_DIGITS,
    `the hp ${SHOTS} shots removed at heat ${PINNED_HEAT}`,
  );
});
