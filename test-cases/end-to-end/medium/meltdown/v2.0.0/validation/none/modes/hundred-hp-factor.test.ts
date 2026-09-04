// modes/hundred-hp-factor — every unit of the onslaught is six times as tough,
// wherever in it that unit arrives.
//
// THE RULE. `specs/modes.md`: on The Hundred, "every unit's maximum hp is its
// base hp times `HUNDRED_HP_SCALE` (`6.0`), wherever in the onslaught it arrives,
// in place of the per-wave scaling". A unit's `maxHp` is reported by the snapshot
// and its base hp is fixed by its type in `specs/surge.md`, so the reading is one
// ratio.
//
// WHY THE UNITS ARE RELEASED RATHER THAN ADDED. "Wherever in the onslaught it
// arrives" is a claim about the RELEASE ORDER, and nothing about an added unit
// carries an order. So the run's own release is turned on — which is what makes
// this one of the items the world gate belongs to — and `wavePending` is used as
// the dial it is: the spawner takes the index of the unit it is about to release
// from how many are still to come, so posing a small `wavePending` puts the next
// releases at the very END of the onslaught. Two readings are taken, one from the
// first unit of the onslaught and one from its last few, and the factor must be
// the same figure at both.
//
// HOW THE EXPECTED FIGURE IS BUILT. From the type the BUILD reported for each
// unit, times the base hp `specs/surge.md` gives that type, times `6.0`. Which
// type arrives at which index is the onslaught's composition, and that is not
// this item's business — so it is read rather than predicted, and what is decided
// here is only the factor applied to whatever arrived. That also makes the check
// bite hardest where it should: the five types the onslaught cycles have base hp
// from `12` to `220`, so a build carrying a constant maximum, or one scaling by
// the wave instead, reads a different number for every unit.
//
// WHAT A WRONG MODEL READS. `hpScale(1)` is exactly `1`, so a build that left the
// per-wave scaling in place reads a Mote at `40` where the rule wants `240`. A
// build that applied the factor once to the wave rather than to each unit reads
// the base hp. A build that scaled by the release index reads a figure that
// changes between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThanOrEqual } from "../assert";
import {
  HUNDRED_HP_SCALE,
  HUNDRED_UNITS,
  SURGE_DEFS,
  WAVE_SPAWN_INTERVAL,
} from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startRun,
  type Harness,
  type UnitView,
} from "../harness";

/**
 * How closely a `maxHp` must match `baseHp * HUNDRED_HP_SCALE`.
 *
 * Four decimals: the figure is one product of a whole number and `6.0`, so a
 * conforming build lands on it exactly and the only honest slack is the last bits
 * of a double. It is not room for a different factor — the nearest wrong model,
 * the per-wave scaling of Wave 1, is five sixths of the figure away.
 */
const HP_DIGITS = 6;

/**
 * How many units are left to release for the LATE reading, and how much game time
 * is given to release them.
 *
 * Three, so the reading is taken on the ninety-eighth, ninety-ninth and hundredth
 * units of the onslaught — as far into it as it goes. The window is three release
 * intervals and a margin, so all three arrive; it is a ceiling on a hung build
 * rather than a bound on anything asserted.
 */
const LATE_PENDING = 3;
const LATE_WINDOW = WAVE_SPAWN_INTERVAL * (LATE_PENDING + 1);

/** What the rule requires of one unit, from the type the build reported for it. */
function expectedMaxHp(unit: UnitView): number {
  return SURGE_DEFS[unit.type].hp * HUNDRED_HP_SCALE;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("gives every unit of the onslaught six times its base hp, early and late", async () => {
  const { debug } = h;
  await startRun(h, "hundred");
  // The onslaught under way, with the run's own release running: this item IS
  // about what the release hands out, so the gate belongs on.
  await debug.setPhase("wave");
  await debug.setBuildTimer(0);
  await debug.setWaveSpawning(true);

  // The FIRST unit of the onslaught: nothing has been released, so the spawner's
  // next index is the opening one.
  await debug.setWavePending(HUNDRED_UNITS);
  await h.advance(framesFor(WAVE_SPAWN_INTERVAL * 2));
  const early = (await h.snapshot()).surge;

  // The LAST few units of the onslaught, reached by telling the run how few are
  // left rather than by waiting out a minute of releases.
  await debug.clearSurge();
  await debug.setWavePending(LATE_PENDING);
  await h.advance(framesFor(LATE_WINDOW));
  const late = (await h.snapshot()).surge;

  await captureStill(h, "tough");

  assertGreaterThanOrEqual(
    early.length,
    1,
    "units released at the opening of the onslaught",
  );
  assertGreaterThanOrEqual(
    late.length,
    1,
    "units released at the end of the onslaught",
  );
  for (const unit of early) {
    assertCloseTo(
      unit.maxHp,
      expectedMaxHp(unit),
      HP_DIGITS,
      `the maximum hp of a ${unit.type} at the opening of the onslaught`,
    );
  }
  for (const unit of late) {
    assertCloseTo(
      unit.maxHp,
      expectedMaxHp(unit),
      HP_DIGITS,
      `the maximum hp of a ${unit.type} at the end of the onslaught`,
    );
  }
});
