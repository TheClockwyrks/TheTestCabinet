// resonance/caps-at-max — an event that would carry the meter past the ceiling
// leaves it at exactly `RESONANCE_MAX`.
//
// THE RULE. specs/resonance.md: "It caps at `RESONANCE_MAX`. An event that would
// carry it past the ceiling leaves it at exactly `RESONANCE_MAX`."
//
// THE POSE IS ONE POINT SHORT AND THE EVENT IS WORTH MORE THAN ONE POINT, which
// is what makes the reading decisive. At `RESONANCE_MAX - 1` a matching kill is
// worth `RESONANCE_KILL` (`4`) — four times the room left — so the three models a
// build can implement read three different numbers: a build that caps reads
// `RESONANCE_MAX` (100), a build that adds without a ceiling reads 103, and a
// build that wraps or resets on overflow reads something at or near `0`. A pose
// further from the ceiling would grade none of them.
//
// THE EVENT IS A MATCHING KILL because specs/resonance.md gives the meter only
// two fills and a kill is the smaller of the two: a build that caps a
// `RESONANCE_ABSORB` (`6`) but not a `RESONANCE_KILL` (`4`) has to fail
// somewhere, and the smaller figure is the harder case to get right.
//
// WHAT THIS DOES NOT DECIDE. That a matching kill fills the meter at all is
// `resonance/kill-fills`; that a full meter reports itself ready is
// `resonance/ready-at-full`.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  PLAYER_BULLET_SPEED,
  RESONANCE_KILL,
  RESONANCE_MAX,
  SHARD_HALF,
} from "../../src/constants";
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
 * Where the meter is posed, in meter points: one point below the ceiling.
 *
 * The review item's own figure — the meter posed one point below `RESONANCE_MAX`
 * — and the value at which a kill worth `RESONANCE_KILL` (`4`) overshoots by
 * three.
 */
const POSED_METER = RESONANCE_MAX - 1;

/**
 * Where the target Shard stands, in logical units.
 *
 * Mid-field on the ship's own lane, well inside the play field on both axes (`y`
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

/** How far below the target the shot is placed: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * Derived rather than chosen. `SHOT_BELOW - TOUCHING` (120) units of climb bring
 * the bullet inside the contact reach, and `PLAYER_BULLET_SPEED` (`760`) is what
 * specs/ship.md gives it to climb at. Twice that is slack for whichever sub-step
 * a build resolves the contact on, and nothing else.
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

it("stops at exactly RESONANCE_MAX when a kill would carry it past", async () => {
  startPosed(h);
  // A stage clears in the moment the last drone of its wave is destroyed
  // (specs/stages.md); the bystander leaves the wave a drone under either
  // reading of "its wave", so the field is still live when the meter is read.
  poseBystander(h);
  h.debug.setResonance(POSED_METER);
  const target = poseDrone(h, "shard", TARGET_X, TARGET_Y, {
    band: MATCHING_BAND,
  });

  assertCloseTo(
    h.snapshot().resonance,
    POSED_METER,
    METER_DIGITS,
    "precondition: the meter stands one point below its ceiling",
  );

  await fireAt(h, TARGET_X, TARGET_Y, MATCHING_BAND, SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "capped");

  const after = h.snapshot();
  assertUndefined(
    droneById(after, target),
    `precondition: the ${MATCHING_BAND} shot destroyed the ${MATCHING_BAND} ` +
      `Shard (specs/bands.md)`,
  );
  assertCloseTo(
    after.resonance,
    RESONANCE_MAX,
    METER_DIGITS,
    `the meter after a kill worth RESONANCE_KILL (${RESONANCE_KILL}) landed ` +
      `with one point of room left: capped at RESONANCE_MAX ` +
      `(${RESONANCE_MAX}) rather than carried to ` +
      `${POSED_METER + RESONANCE_KILL} (specs/resonance.md)`,
  );
});
