// Meltdown — combat/fires-at-its-rate: an emitter fires at its stated rate.
//
// specs/combat.md's fire clock: the frame's game time is added to the emitter's
// accumulator on every frame it has a target and is online, and "each time the
// accumulator reaches `1 / fireRate` ... one shot resolves and `1 / fireRate` is
// subtracted". So "a run of firing ... lands its first shot one full interval
// after the target was acquired, not on the frame it appeared", and one every
// interval after that. specs/towers.md gives the Arc `2.0` shots a second, so its
// interval is half a second: nothing at `0.25` s, one shot by `0.75` s, and one
// more every half-second after.
//
// THE SHOT COUNT IS READ IN UNITS OF THE FIRST SHOT, WHICH IS WHAT MAKES THIS A
// READING OF THE RATE ALONE. Every observable a shot leaves is some other item's
// figure — the hp it removes is `combat/damage-per-shot`'s, the heat it adds is
// `heat/firing-adds-heat`'s — so a count taken in hit points would fail this point
// for a build whose rate is perfect and whose damage figure is not. What this
// point does instead is measure the removal ONE shot makes and count the later
// removals against it. A build that fires twice as hard passes; a build that fires
// twice as often does not.
//
// WHERE THE CHECKPOINTS FALL. `ticksForShots(n, rate)` lands half an interval past
// the `n`-th shot, which is the furthest point in the cycle from both boundaries,
// so `n` shots have resolved whichever side of an exact multiple a build's own
// accumulation of a hundred floating-point deltas falls on.
//
// THE HEAT CANNOT MOVE AND THE MARK CANNOT LEAVE. The Arc is pinned, so every shot
// of the drive removes the same amount and the count in units of the first is
// exact; the mark holds its tile with hp far past five shots' worth, so it neither
// walks out of range nor dies partway through.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import {
  NEAR_UNITS,
  fireRateOf,
  poseGun,
  poseMarkEast,
  readHp,
  ticksForShots,
} from "./duel";

/** The emitter read, and the heat it is pinned at. */
const TOWER = "arc";
const HEAT = 0;

/** specs/towers.md: the Arc fires 2.0 shots a second. */
const FIRE_RATE = fireRateOf(TOWER);

/** How many shots the drive walks through, one checkpoint each. */
const SHOTS = 4;

/**
 * How close each count must come, as decimal places of a shot.
 *
 * Two places is `0.005` of a shot. Every shot of this drive removes the same
 * amount — the heat is pinned, so the multiplier cannot move — which makes the
 * ratio of a cumulative removal to one shot's an exact integer up to the float
 * slack of a few subtractions, many orders below the bound. What the bound
 * excludes is every neighbouring rate: a build one shot behind or ahead at a
 * checkpoint reads a whole integer away.
 */
const COUNT_DIGITS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("An emitter fires at its stated rate", async () => {
  poseGun(h, TOWER, HEAT);
  const mark = poseMarkEast(h, TOWER, "mote", NEAR_UNITS);
  const opened = readHp(h, mark);

  // Cumulative hp removed at half an interval past the n-th shot, n = 0..SHOTS.
  const removed: number[] = [];
  let driven = 0;
  for (let n = 0; n <= SHOTS; n += 1) {
    const wanted = ticksForShots(n, FIRE_RATE);
    await h.advance(wanted - driven);
    driven = wanted;
    removed.push(opened - readHp(h, mark));
  }
  captureStill(h, "rate");

  assertEqual(
    removed[0],
    0,
    `hp removed ${0.5 / FIRE_RATE}s in, half an interval before the first shot`,
  );
  assertGreaterThan(
    removed[1],
    0,
    `hp removed by the first shot, one ${1 / FIRE_RATE}s interval in`,
  );
  for (let n = 2; n <= SHOTS; n += 1) {
    assertCloseTo(
      removed[n] / removed[1],
      n,
      COUNT_DIGITS,
      `shots resolved by ${(n + 0.5) / FIRE_RATE}s, in units of the first shot`,
    );
  }
});
