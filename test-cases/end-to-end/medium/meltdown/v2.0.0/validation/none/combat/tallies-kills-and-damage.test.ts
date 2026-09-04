// Meltdown — combat/tallies-kills-and-damage: a tower tallies what it did.
//
// `specs/combat.md`, on what each emitter keeps "for its whole life on the floor":
// "`damageDealt` accumulates the hp each of its shots ACTUALLY REMOVED, splash
// included, so a killing blow adds only the hp the unit had left", and "`kills`
// rises by one for each unit one of its shots takes to `0` hp."
//
// TWO SCENARIOS, BECAUSE THE TWO CLAUSES PULL IN DIFFERENT DIRECTIONS.
//
//   - A RUN OF SHOTS ON A UNIT THAT SURVIVES THEM. Three shots into a mark with hp
//     far past their worth, and `damageDealt` must equal the hp the mark lost —
//     measured on the mark, not computed from a figure, so what is graded is the
//     tally rather than the per-shot damage `combat/damage-per-shot` owns. A build
//     that tallies shots rather than hp reads `3`; one that tallies the damage it
//     INTENDED rather than the damage it removed reads the same here and differently
//     in the second scenario; one that tallies nothing reads `0`. And `kills` must
//     still be `0`, because nothing died.
//   - A KILLING BLOW ON A MARK WITH ONE HP. `kills` must rise to exactly `1`, and
//     `damageDealt` must rise by exactly `1` — the hp the mark had left — rather
//     than by the `2.1` an Arc's shot at heat `0` asks for. That is the clause about
//     what a killing blow adds, and the two readings together are the reason the
//     mark is posed at one hp: the overkill is more than twice the hp available, so
//     a build that tallies the intended figure is out by a clear margin.
//
// EACH SCENARIO IS POSED FROM SCRATCH, so the tallies it reads start at zero on a
// tower `addTower` has just appended and its fire clock opens at zero
// (`specs/instrumentation.md`).
//
// THE HEAT IS PINNED, so every shot of the first run removes the same amount and the
// equality is exact; and nothing but the one mark stands on the floor, so no splash,
// no second gun and no other death can reach either tally.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertTrue,
} from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  framesForShots,
  type Harness,
} from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readGun,
  readHp,
} from "./duel";

/** The emitter read, at level I, pinned cold, and the unit it fires on. */
const TOWER = "arc";
const LEVEL = 1;
const HEAT = 0;
const MARK = "mote";

/** How many shots the surviving mark takes. */
const SHOTS = 3;

/** The hp the doomed mark is posed with: the least a live unit can carry. */
const DOOMED_HP = 1;

/**
 * How long the kill is waited for: six seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how far a
 * build may miss a figure by. An Arc at its specified `2.0` shots a second lands a
 * dozen shots inside it, so a build whose rate or per-shot damage is off still
 * removes a single hp, and the kill this point reads rests on a shot landing at all.
 */
const KILL_FRAMES = framesFor(6);

/**
 * How close each tally must come, as decimal places of a hit point.
 *
 * Six places is `0.0000005` hp. Both sides of each comparison are the same sum a
 * build accumulated, so a conformant build's two readings differ by float slack
 * alone; the bound is tight because the wrong models are not close — a tally of
 * shots rather than hp is out by a factor of two, and a killing blow tallied at its
 * intended `2.1` rather than the `1` available is out by `1.1`.
 */
const TALLY_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("A placed tower tallies what it did", async () => {
  // Scenario one: a run of shots on a mark that survives them.
  const runGun = await poseGun(h, TOWER, HEAT, LEVEL);
  const survivor = await poseMarkEast(h, TOWER, MARK, NEAR_UNITS);
  const openedSurvivor = await readHp(h, survivor);

  await h.advance(framesForShots(SHOTS, fireRateOf(TOWER, LEVEL)));
  const afterRun = await readGun(
    h,
    runGun,
    `the ${TOWER} after ${SHOTS} shots`,
  );
  const removed = openedSurvivor - (await readHp(h, survivor));

  // Scenario two: a killing blow on a mark with one hp.
  const killGun = await poseGun(h, TOWER, HEAT, LEVEL);
  await poseMarkEast(h, TOWER, MARK, NEAR_UNITS, DOOMED_HP);

  const died = await h.until((snapshot) => snapshot.surge.length === 0, {
    poll: 2,
    maxFrames: KILL_FRAMES,
  });
  await captureStill(h, "tallies");
  const afterKill = await readGun(h, killGun, `the ${TOWER} after its kill`);

  assertGreaterThan(
    removed,
    0,
    `precondition: hp the ${TOWER} removed over ${SHOTS} shots`,
  );
  assertCloseTo(
    afterRun.damageDealt,
    removed,
    TALLY_DIGITS,
    `the damageDealt a ${TOWER} tallied over ${SHOTS} shots, against the hp its ` +
      `mark actually lost`,
  );
  assertEqual(
    afterRun.kills,
    0,
    `the kills a ${TOWER} tallied over ${SHOTS} shots at a mark that survived them`,
  );

  assertTrue(
    died.hit,
    `precondition: the ${TOWER}'s shot killed a mark posed at ${DOOMED_HP} hp`,
  );
  assertEqual(
    afterKill.kills,
    1,
    `the kills a ${TOWER} tallied after taking one mark to 0 hp`,
  );
  assertCloseTo(
    afterKill.damageDealt,
    DOOMED_HP,
    TALLY_DIGITS,
    `the damageDealt a ${TOWER} tallied for a killing blow on a mark with ` +
      `${DOOMED_HP} hp left, which is what the blow actually removed`,
  );
});
