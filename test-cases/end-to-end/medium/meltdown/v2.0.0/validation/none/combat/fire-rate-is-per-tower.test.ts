// Meltdown — combat/fire-rate-is-per-tower: each tower's rate is its own.
//
// `specs/towers.md` gives every emitter its own fire rate, and `specs/combat.md`
// resolves a shot each time the accumulator reaches `1 / fireRate` "at the
// emitter's current level". So the Stutter's `7.0` shots a second put seven shots
// inside a second, and the Lance's `0.8` put four inside five.
//
// TWO EMITTERS, BECAUSE ONE RATE CANNOT TELL A TABLE FROM A CONSTANT. A build
// that fires everything at one rate lands the same count for both, and the two
// chosen are the extremes of the roster — nearly nine times apart — so no single
// figure and no arithmetic over a shared one lands on both. A build that read the
// column as an INTERVAL rather than a rate reads seven shots in fifty seconds and
// four in a fifth of a second; a build that fires once a frame reads hundreds.
//
// THE COUNT IS TAKEN IN UNITS OF THE FIRST SHOT, so what is graded is how OFTEN
// each fires and not how hard: the per-shot figure is
// `combat/damage-per-shot`'s. Each drive lands half an interval past the shot it
// is counting to (`framesForShots`), the furthest point in the cycle from either
// boundary.
//
// THE SECOND SCENARIO IS POSED FROM SCRATCH. A fire accumulator carries between
// frames, so the Lance is a NEW emitter on a floor `startRun` emptied rather than
// the Stutter's site re-armed, and its clock opens at zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  framesForShots,
  type Harness,
} from "../harness";
import { NEAR_UNITS, fireRateOf, poseGun, poseMarkEast, readHp } from "./duel";

/** The two ends of the roster, and the shot count each is driven to. */
const FAST = { type: "stutter", shots: 7 } as const;
const SLOW = { type: "lance", shots: 4 } as const;

/** The heat both are pinned at: the heat a placed tower starts at. */
const HEAT = 0;

/**
 * How close each count must come, as decimal places of a shot.
 *
 * Two places is `0.005` of a shot. With the heat pinned every shot of a drive
 * removes the same amount, so a cumulative removal over one shot's is an exact
 * integer up to a few subtractions' float slack; the bound is there to exclude a
 * count that is out by a whole shot, which is what any wrong rate produces.
 */
const COUNT_DIGITS = 2;

/** The shots resolved by half an interval past the `shots`-th, over one shot's worth. */
async function countedShots(
  harness: Harness,
  type: "stutter" | "lance",
  shots: number,
): Promise<number> {
  const rate = fireRateOf(type);
  await poseGun(harness, type, HEAT);
  const mark = await poseMarkEast(harness, type, "mote", NEAR_UNITS);
  const opened = await readHp(harness, mark);

  const firstFrames = framesForShots(1, rate);
  await harness.advance(firstFrames);
  const afterOne = opened - (await readHp(harness, mark));
  assertGreaterThan(
    afterOne,
    0,
    `hp the ${type}'s first shot removed, one ${1 / rate}s interval in`,
  );

  await harness.advance(framesForShots(shots, rate) - firstFrames);
  return (opened - (await readHp(harness, mark))) / afterOne;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("Each tower's rate is its own", async () => {
  const fast = await countedShots(h, FAST.type, FAST.shots);
  const slow = await countedShots(h, SLOW.type, SLOW.shots);
  await captureStill(h, "rates");

  assertCloseTo(
    fast,
    FAST.shots,
    COUNT_DIGITS,
    `shots a ${FAST.type} at ${fireRateOf(FAST.type)}/s resolved in ` +
      `${(FAST.shots + 0.5) / fireRateOf(FAST.type)}s`,
  );
  assertCloseTo(
    slow,
    SLOW.shots,
    COUNT_DIGITS,
    `shots a ${SLOW.type} at ${fireRateOf(SLOW.type)}/s resolved in ` +
      `${(SLOW.shots + 0.5) / fireRateOf(SLOW.type)}s`,
  );
});
