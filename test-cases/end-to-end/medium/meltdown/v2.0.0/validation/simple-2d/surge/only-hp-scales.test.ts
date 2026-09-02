// surge/only-hp-scales — the wave scales hp and nothing else: a wave-20 Mote still
// runs at 60, still pays 3, and still costs one life.
//
// THE RULE. specs/waves.md, Per-wave scaling: "Nothing else scales with the wave.
// Speeds, bounties, and leak values are the same on the last wave as on the first,
// and every other system is unchanged across a run." specs/surge.md agrees from
// the other side: HP is "the type's base hp before the per-wave scaling", and no
// other column of the roster is qualified that way.
//
// THIS IS `hp-scales-with-the-wave` READ IN THE OTHER DIRECTION, and the pair is
// what makes either one mean anything. That point says the hp must move; this one
// says the three figures beside it must not. A build that scaled every stat with
// the wave passes that point and fails this one; a build that scaled nothing at all
// passes this one and fails that one.
//
// THE PRECONDITION IS THAT THE WAVE ACTUALLY TOOK EFFECT. Three readings that are
// unchanged are exactly what a build that ignores the wave number altogether
// produces, so this point first reads the wave-20 Mote's maximum hp and requires it
// to have moved off the base. Without that the whole check would pass vacuously on
// the worst build it is meant to catch.
//
// WHY THE COMPARISON IS AGAINST THE ROSTER AND NOT AGAINST A WAVE-1 READING. The
// figures specs/surge.md fixes are the ones that must still hold, so each reading
// is compared to the table entry itself. A build whose Mote is wrong on wave 1 as
// well is wrong at `mote-stats`, and this point is left saying only what it is
// about: that the wave number moved none of them.
//
// THREE READINGS, THREE FLOORS. The speed is read off the arrival, and it is the
// unslowed `baseSpeed` — nothing in the scenario slows anything, so the current
// speed follows it. The bounty is read as money paid on the frame the Mote's hp
// reaches `0`, on a floor holding one Arc and one one-hp mark. The leak is read as
// lives taken on the frame it reaches its exhaust, on a floor holding nothing but
// the leaker. Each is posed fresh by `surge/roster.ts`, on wave 20, so nothing one
// reading did can reach another.
//
// WAVE 20 IS THE LAST WAVE OF THE 20-WAVE CONTAINMENT RUN `startRun` OPENS
// (specs/modes.md), which is where the scaling is at its largest — a multiplier of
// `12.78`, so a build that scaled the speed with the hp would be walking this Mote
// at over `760` logical units a second rather than at `60`.
//
// WHAT EVERY WRONG MODEL READS. A build that scaled every stat reads `766.8` for
// the speed, `38` for the bounty and `12` lives for the leak; one that scaled the
// bounty alone reads the bounty wrong and the other two right; one that ignores the
// wave entirely fails the precondition.

import { afterEach, beforeEach, it } from "vitest";
import { SURGE_DEFS, hpScale } from "../constants";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bountyPaidFor, livesLostTo, readArrival } from "./roster";

/** The wave the readings are taken on: the last of a 20-wave Containment run. */
const DEEP_WAVE = 20;

/** The Mote's row, which is what all three readings must still equal. */
const ROW = SURGE_DEFS.mote;

/**
 * The decimal places a speed is compared to: six.
 *
 * `baseSpeed` is a whole number in the roster and nothing in this scenario is
 * meant to touch it, so the only difference a correct build can show is
 * floating-point noise. Six places is `5e-7`, which is far below the smallest
 * scaling error this point exists to catch: the least a build could scale the
 * speed by and still be scaling it is one wave's `0.62`, which moves `60` by
 * `37.2`.
 */
const SPEED_DIGITS = 6;

/**
 * The decimal places the precondition's scaled hp is compared to: four.
 *
 * `baseHp * (1 + 0.62 * (w - 1))` is evaluated in binary floating point, so a
 * build computing it in any sensible order lands within parts in `10^-13` of the
 * figure. Four places is `5e-5`, many orders above that and many orders below the
 * `471.2` this precondition is separating from the base.
 */
const HP_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a wave-20 Mote's speed, bounty and leak at their wave-1 figures", async () => {
  const arrived = await readArrival(h, "mote", DEEP_WAVE);
  captureStill(h, "unscaled");

  const bounty = await bountyPaidFor(h, "mote", DEEP_WAVE);
  const leak = await livesLostTo(h, "mote", DEEP_WAVE);

  // The precondition: the wave number reached the arrival at all. Without this a
  // build that ignores the wave passes every reading below.
  assertCloseTo(
    arrived.maxHp,
    ROW.hp * hpScale(DEEP_WAVE),
    HP_DIGITS,
    `precondition: a wave-${DEEP_WAVE} Mote's maximum hp, which the scaling ` +
      `must have moved off its base ${ROW.hp}`,
  );

  assertCloseTo(
    arrived.baseSpeed,
    ROW.speed,
    SPEED_DIGITS,
    `the unslowed speed of a wave-${DEEP_WAVE} Mote`,
  );
  assertCloseTo(
    arrived.speed,
    ROW.speed,
    SPEED_DIGITS,
    `the current speed of a wave-${DEEP_WAVE} Mote, with nothing slowing it`,
  );

  assertTrue(bounty.killed, "precondition: the Arc's shot killed the Mote");
  assertEqual(
    bounty.paid,
    ROW.bounty,
    `the money killing a wave-${DEEP_WAVE} Mote paid`,
  );

  assertTrue(leak.leaked, "precondition: the Mote reached its exhaust");
  assertEqual(
    leak.lost,
    ROW.leak,
    `the lives leaking a wave-${DEEP_WAVE} Mote cost`,
  );
});
