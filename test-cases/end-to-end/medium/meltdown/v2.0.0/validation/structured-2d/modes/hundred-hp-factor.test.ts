// Meltdown — modes/hundred-hp-factor: every unit of the onslaught carries six
// times its base hp, wherever in the onslaught it arrives.
//
// THE RULE. `specs/modes.md`, The Hundred: "Every unit's maximum hp is its base
// hp times `HUNDRED_HP_SCALE` (`6.0`), wherever in the onslaught it arrives, in
// place of the per-wave scaling." The base hp of each type is the HP column of
// `specs/surge.md`'s table, and the per-wave scaling this replaces is
// `specs/waves.md`'s `hpScale(w) = 1 + 0.62 * (w - 1)`.
//
// THE UNITS ARE RELEASED, NOT ADDED. `addUnit` would answer the same question,
// but the rule is about what the ONSLAUGHT carries, so the world gate is turned
// back on — this is one of the closed list of items that turn it on — and the
// spawner is left to release its own units at its own cadence into a posed wave
// phase. What each one carries is then the build's own answer.
//
// "WHEREVER IN THE ONSLAUGHT IT ARRIVES" IS THE SECOND LEG, AND IT IS WHY
// `wavePending` IS POSED. `specs/instrumentation.md` makes `setWavePending` "how
// many units of the current wave are still to be released", which is exactly how
// far through the onslaught the spawner believes it is. The first leg poses a
// fresh onslaught, with all `100` still owed, so the units watched are its first;
// the second poses `4` still owed, so the units watched are its last. A build
// that ramps hp with progress through the onslaught — the wrong model this rule
// exists to forbid — reads two different figures across those legs, and a build
// that applies the factor to the first unit alone reads the base hp in the
// second. Posing the counter is also what keeps this point cheap: the alternative
// is a minute of game time spent re-deciding the release
// `modes.hundred-releases-one-hundred` already grades.
//
// THE EXPECTED FIGURE IS BUILT FROM THE TYPE THE UNIT REPORTS. The onslaught
// cycles `WAVE_CYCLE` one unit at a time, so the two legs field different types;
// each unit's expectation is `specs/surge.md`'s base hp for its OWN type times
// `6.0`. So a build whose composition is wrong is graded on its composition by
// `modes.hundred-releases-one-hundred` and on its hp by this point, rather than
// failing both for one fault.
//
// THE TOLERANCE IS `5e-7` AND IT IS FLOAT REPRESENTATION ALONE. Every base hp in
// `specs/surge.md` is a whole number and the factor is exactly `6`, so every
// product is a whole number of hp; the nearest wrong model — the per-wave scaling
// that this replaces, `hpScale(1) = 1` on the mode's one wave — is a factor of six
// away.
//
// WHAT EVERY WRONG MODEL READS. A build that kept the per-wave scaling reads the
// base hp; one that applied `6.0` as an ADDITION reads base plus six; one that
// scaled by the wave count reads the base hp again; one that ramps across the
// onslaught reads the base times six only in the first leg.

import { afterEach, beforeEach, it } from "vitest";
import {
  HUNDRED_HP_SCALE,
  HUNDRED_UNITS,
  SURGE_DEFS,
  WAVE_SPAWN_INTERVAL,
} from "../constants";
import { assertCloseTo, assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
  type UnitSnapshot,
} from "../harness";

/** The mode this point reads, and its one wave. */
const MODE = "hundred";
const ONSLAUGHT = 1;

/**
 * How far through the onslaught each leg is posed: all hundred still owed, and
 * four still owed.
 *
 * Geometry, not a tolerance. `4` is small enough that the units the leg watches
 * are the onslaught's last and large enough that the spawner has several left to
 * release inside the window, so neither leg runs the counter to `0` and clears
 * the wave under the reading.
 */
const LEGS: readonly { name: string; pending: number }[] = [
  { name: "the onslaught's first units", pending: HUNDRED_UNITS },
  { name: "the onslaught's last units", pending: 4 },
];

/**
 * The units each leg waits for before it reads: three, so a ramp across the
 * onslaught has three readings to show itself in rather than one.
 */
const WANTED = 3;

/**
 * How long each leg gives the spawner to release them: four times the game time
 * a compliant release of that many takes.
 *
 * Geometry, not a tolerance, and deliberately generous. Each leg stops the moment
 * it has what it wants, so a compliant build spends under two seconds of game
 * time here; the ceiling exists only so a build whose cadence is slow still
 * reaches this item's verdict on the hp its units carry rather than failing it on
 * a rate `surge.spawn-cadence` decides.
 */
const CEILING = ticksFor(4 * WANTED * WAVE_SPAWN_INTERVAL);

/**
 * How often the roster is swept: every quarter second of game time, comfortably
 * inside one cadence interval.
 */
const POLL = ticksFor(0.25);

/**
 * Decimal places a unit's hp must match its expected figure to.
 *
 * `6` is a tolerance of `5e-7`: every base hp is a whole number and the factor is
 * exactly `6`, so the expected figure is a whole number of hp and this absorbs
 * float representation and nothing else.
 */
const HP_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/**
 * Release units into a posed onslaught with `pending` still owed, and hand back
 * what arrived.
 *
 * Each arrival is frozen where the spawner put it — `setUnitMotion(id, false)`
 * holds a unit's locomotion "and nothing else" (`specs/instrumentation.md`) — so
 * nothing walks out through an exhaust and empties the roster the reading is
 * taken from. What a unit does after it arrives is `mazing`'s business, not this
 * item's; what it arrived CARRYING is this item's.
 */
async function releaseWith(pending: number): Promise<UnitSnapshot[]> {
  startRun(h, MODE);
  h.debug.setWave(ONSLAUGHT);
  h.debug.setPhase("wave");
  h.debug.setWavePending(pending);
  h.debug.setWaveSpawning(true);

  for (let run = 0; run < CEILING; run += POLL) {
    await h.advance(Math.min(POLL, CEILING - run));
    const arrived = h.snapshot().surge;
    for (const unit of arrived) {
      if (unit.motion) h.debug.setUnitMotion(unit.id, false);
    }
    if (arrived.length >= WANTED) break;
  }
  return h.snapshot().surge;
}

it("gives every unit of the onslaught six times its base hp, early and late", async () => {
  for (const leg of LEGS) {
    const released = await releaseWith(leg.pending);

    captureStill(h, "tough");

    assertEqual(
      h.snapshot().mode,
      MODE,
      "precondition: the mode the onslaught is posed on",
    );
    assertTrue(
      released.length > 0,
      `precondition: the spawner released something among ${leg.name}`,
    );
    for (const unit of released) {
      assertCloseTo(
        unit.maxHp,
        SURGE_DEFS[unit.type].hp * HUNDRED_HP_SCALE,
        HP_DIGITS,
        `the maximum hp of a ${unit.type} among ${leg.name}`,
      );
    }
  }
});
