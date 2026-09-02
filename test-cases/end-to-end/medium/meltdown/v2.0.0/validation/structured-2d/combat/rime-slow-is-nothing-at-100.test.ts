// Meltdown — combat/rime-slow-is-nothing-at-100: a red-hot Rime slows nothing.
//
// specs/combat.md: "a Rime at heat `100` applies nothing at all", and, flatly, "A
// shot whose `slowFactor(H)` is `0` applies no slow at all." So a Rime pinned at the
// top of the scale may go on removing hp — its damage is at its maximum there, which
// `combat/rime-deals-its-damage` decides — while leaving its target's speed exactly
// where it found it.
//
// THE EDGE CASE IS THE ZERO ITSELF, which is why it is a point of its own rather
// than the last row of `combat/rime-slow-degrades-with-heat`. A build that applies
// whatever the formula returns lands a slow of `0` on the unit and sets its timer to
// `SLOW_TIME`, so the unit reports `slowed` true with a factor of `0` — legal
// arithmetic, a wrong reading of the rule, and invisible to any check that only
// compares factors. The three readings below — `slowed` false, `slowFactor` `0`, and
// the unit's own `baseSpeed` — are that reading in one direction.
//
// THE SHOT IS PROVED TO HAVE LANDED, AND THAT PRECONDITION IS WHAT KEEPS THIS POINT
// HONEST. A Rime that never fires at all leaves a unit at its base speed too, so the
// check first states that hp fell — over two fire intervals, so the reading does not
// rest on a single boundary — and only then reads the speed.
//
// PINNED AT `100`, WHICH IS ONLY REACHABLE BECAUSE THE TOWER IS PINNED: the trip
// belongs to the heat model and `setTowerThermal(id, false)` holds it
// (specs/instrumentation.md), so the Rime sits at the top of the scale and fires.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { SURGE_DEFS, TRIP_HEAT } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  ticksForShots,
  unitOf,
} from "./duel";

/** The one emitter that slows, at level I, pinned at the top of the scale. */
const TOWER = "rime";
const LEVEL = 1;
const HEAT = TRIP_HEAT;

/** The unit read, and its `baseSpeed` from specs/surge.md. */
const MARK = "mote";
const BASE_SPEED = SURGE_DEFS[MARK].speed;

/** How many shots the drive lands before the speed is read. */
const SHOTS = 2;

/**
 * How close the unslowed speed must come, as decimal places of a logical unit per
 * second.
 *
 * Three places is `0.0005`. An unslowed unit's speed is its roster figure unchanged,
 * so a conformant build reads `60` exactly; what the bound excludes is every slow a
 * level-I Rime could have applied here, the smallest of which — one hundredth of the
 * cold ceiling — would take `0.33` off.
 */
const SPEED_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A red-hot Rime slows nothing", async () => {
  poseGun(h, TOWER, HEAT, LEVEL);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const opened = readHp(h, mark);

  await h.advance(ticksForShots(SHOTS, fireRateOf(TOWER, LEVEL)));
  captureStill(h, "nothing");
  const hit = unitOf(h.snapshot(), mark);

  assertGreaterThan(
    opened - hit.hp,
    0,
    `precondition: hp the ${TOWER} at heat ${HEAT} removed over ${SHOTS} shots`,
  );
  assertEqual(
    hit.slowed,
    false,
    `the ${MARK} carrying a slow after being shot by a ${TOWER} at heat ${HEAT}`,
  );
  assertEqual(
    hit.slowFactor,
    0,
    `the slow on the ${MARK} after a ${TOWER} at heat ${HEAT} hit it`,
  );
  assertCloseTo(
    hit.speed,
    BASE_SPEED,
    SPEED_DIGITS,
    `the ${MARK}'s speed after a ${TOWER} at heat ${HEAT} hit it`,
  );
});
