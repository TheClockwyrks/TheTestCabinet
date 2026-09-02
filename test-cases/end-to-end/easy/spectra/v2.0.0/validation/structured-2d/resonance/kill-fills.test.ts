// resonance/kill-fills — destroying a Shard with a matching shot raises the meter
// by exactly `RESONANCE_KILL`.
//
// THE RULE. The second of the two events specs/resonance.md fills the meter from:
// "One of the player's bullets destroys a drone by matching its band |
// `RESONANCE_KILL` (`4`)". A Shard carries a fixed band for its life
// (specs/drones.md) and has no shell and no shimmer to swap it, so with no
// inversion running a cyan shot into a stored-cyan Shard is exactly the matching
// kill, reached with nothing else on the field that could move the meter.
//
// THE METER IS POSED AWAY FROM ZERO. From `0` a build that ADDS `RESONANCE_KILL`
// and a build that SETS the meter to it read the same number; posed at
// {@link POSED_METER} they read different ones, and a build that pays a kill the
// ABSORB figure (`6`) reads a third. The reading therefore names which wrong
// model the build implemented rather than only that one is there. It also leaves
// the ceiling far out of reach, so the cap `resonance/caps-at-max` grades decides
// nothing here.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys at all is
// `bands/match-destroys`; what the kill SCORES is `scoring`'s; what an absorbed
// bullet adds is `resonance/absorb-fills`.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SHARD_HALF,
} from "../constants";
import { assertCloseTo, assertUndefined } from "../assert";
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
import { poseBystander } from "./wave";

/**
 * Where the meter is posed before the kill, in meter points.
 *
 * A fifth of `RESONANCE_MAX` (`100`): clear of `0`, so adding and setting read
 * differently, and clear of the ceiling, so `POSED_METER + RESONANCE_KILL` (24)
 * is nowhere near the cap.
 */
const POSED_METER = 20;

/**
 * Where the target Shard stands, in logical units.
 *
 * Mid-field on the ship's own lane: well inside the play field on both axes (`y`
 * in `[64, 656]`, specs/field.md), far above the ship's lane at `SHIP_Y` (`600`),
 * and clear of the corner the bystander holds.
 */
const TARGET_X = LANE_CENTER;
const TARGET_Y = 300;

/** The band both the drone and the shot carry: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How close two centres come for the circles to overlap, in logical units.
 *
 * specs/simulation.md decides a contact as an overlap of two circles of the
 * half-extents their own specs state: `SHARD_HALF` (`14`, specs/drones.md) and
 * `PLAYER_BULLET_HALF` (`6`, specs/ship.md).
 */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Seven times the contact reach, so the bullet starts well clear of the drone and
 * the kill the meter reads is one the FLIGHT produced rather than one the
 * placement did.
 */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * Derived rather than chosen. `SHOT_BELOW - TOUCHING` (120) units of climb bring
 * the bullet inside the contact reach, and `PLAYER_BULLET_SPEED` (`760`,
 * specs/ship.md) is what specs/ship.md gives it to climb at, so the contact is
 * inside the frames that speed needs to close that gap. Twice that is slack for
 * whichever sub-step a build resolves the contact on, and nothing else.
 */
const FLIGHT_TICKS =
  2 * ticksFor((SHOT_BELOW - TOUCHING) / PLAYER_BULLET_SPEED);

/**
 * Decimal places the meter is read to.
 *
 * specs/resonance.md states the meter's figures as whole numbers, so the only
 * slack allowed is the round-off of a build that carries the meter as a fraction
 * of `RESONANCE_MAX` and reports it scaled.
 */
const METER_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly RESONANCE_KILL when a matching shot destroys a Shard", async () => {
  startPosed(h);
  // A stage clears in the moment the last drone of its wave is destroyed
  // (specs/stages.md), and this scenario destroys the drone it poses; the
  // bystander leaves the wave a drone under either reading of "its wave", so the
  // field is still live when the meter is read.
  poseBystander(h);
  h.debug.setResonance(POSED_METER);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: MATCHING_BAND,
  });

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter the kill is measured from",
  );

  await fireAt(h, TARGET_X, TARGET_Y, MATCHING_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "filled");

  const after = h.snapshot();
  assertUndefined(
    droneById(after, target),
    `precondition: the ${MATCHING_BAND} shot destroyed the ${MATCHING_BAND} ` +
      `Shard (specs/bands.md)`,
  );
  assertCloseTo(
    after.resonance,
    POSED_METER + RESONANCE_KILL,
    METER_DIGITS,
    `the meter after one matching kill: ${POSED_METER} + RESONANCE_KILL ` +
      `(${RESONANCE_KILL}) (specs/resonance.md), out of RESONANCE_MAX ` +
      `(${RESONANCE_MAX})`,
  );
});
