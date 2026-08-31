// Meltdown — combat/rime-slows-when-cold: a cold Rime slows hardest.
//
// specs/combat.md: "On the frame a Rime's shot resolves it applies a slow to its
// target", of strength `slowFactor(H) = slowCeil * (1 - H / 100)`, and "A slow
// removes that fraction of the unit's base speed, so a slowed unit's current speed
// is `baseSpeed * (1 - slowFactor)`". specs/towers.md gives a level-I Rime a
// `RIME_SLOW_CEIL` of `0.55`, so at heat `0` the slow is `0.55` exactly — the
// hardest a level-I Rime can slow anything. specs/surge.md gives the Mote
// `baseSpeed` `60`, so its speed under that slow is `27`.
//
// THE SPEED IS READ AS WELL AS THE FACTOR, and that is the point of the pair. A
// build can record `slowFactor` faithfully and never apply it — the number appears
// in the snapshot and nothing in the game moves any slower — and the `27` is what
// catches that. Both are one requirement in one direction: the cold slow lands and
// it bites.
//
// `baseSpeed` IS READ BACK FROM THE SNAPSHOT AND ASSERTED AGAINST THE ROSTER FIGURE,
// so the `27` is not quietly grading two things at once: if a build gave the Mote
// the wrong base speed that is `surge/*`'s item, and the precondition names it
// rather than letting it land here as a slow that is off by a factor.
//
// THE RIME IS PINNED AT `0`, so the slow that lands is the slow the heat posed gives
// it and not one a drifting thermal model reduced between the acquisition and the
// shot; the mark's motion is off, so the speed is read without the mark walking out
// of range; and the drive stops half an interval past the first shot, the furthest
// point in the fire cycle from either boundary.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { SURGE_DEFS } from "../../src/constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  slowCeilOf,
  ticksForShots,
  unitOf,
} from "./duel";

/** The one emitter that slows (specs/towers.md), at level I, pinned cold. */
const TOWER = "rime";
const LEVEL = 1;
const HEAT = 0;

/** The unit read, and its `baseSpeed` from specs/surge.md. */
const MARK = "mote";
const BASE_SPEED = SURGE_DEFS[MARK].speed;

/** specs/combat.md at heat 0: `slowCeil * (1 - 0 / 100)`, so 0.55. */
const EXPECTED_FACTOR = slowCeilOf(LEVEL) * (1 - HEAT / 100);

/** specs/combat.md: `baseSpeed * (1 - slowFactor)`, so 60 * 0.45, which is 27. */
const EXPECTED_SPEED = BASE_SPEED * (1 - EXPECTED_FACTOR);

/**
 * How close the two readings must come, as decimal places.
 *
 * Four places on the factor is `0.00005`, and three on the speed is `0.0005` of a
 * logical unit per second. Both are one product of figures the specification states
 * exactly, computed once by the build, so a conformant build needs none of the room;
 * what the bounds exclude is every neighbouring ceiling on the roster — level II's
 * `0.68` and level III's `0.80` are `0.13` and `0.25` away, and the speeds they
 * give, `19.2` and `12`, are whole units away from `27`.
 */
const FACTOR_DIGITS = 4;
const SPEED_DIGITS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("A cold Rime slows hardest", async () => {
  poseGun(h, TOWER, HEAT, LEVEL);
  const mark = poseMarkEast(h, TOWER, MARK, NEAR_UNITS);

  await captureReplay(h, "slow", () =>
    h.advance(ticksForShots(1, fireRateOf(TOWER, LEVEL))),
  );
  const slowed = unitOf(h.snapshot(), mark);

  assertEqual(
    slowed.baseSpeed,
    BASE_SPEED,
    `precondition: the ${MARK}'s baseSpeed, which specs/surge.md fixes`,
  );
  assertEqual(
    slowed.slowed,
    true,
    `the ${MARK} carrying a slow after one shot`,
  );
  assertCloseTo(
    slowed.slowFactor,
    EXPECTED_FACTOR,
    FACTOR_DIGITS,
    `the slow a level-${LEVEL} ${TOWER} at heat ${HEAT} applied`,
  );
  assertCloseTo(
    slowed.speed,
    EXPECTED_SPEED,
    SPEED_DIGITS,
    `the ${MARK}'s speed under that slow, against baseSpeed ${BASE_SPEED}`,
  );
});
