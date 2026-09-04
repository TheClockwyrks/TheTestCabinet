// pressure/extraction-drop — each core a removal takes off the channel drops
// pressure by 0.8.
//
// WHAT THE SPEC FIXES. `specs/channel.md` ("Pressure") states the drop exactly:
// "Fall for each core a removal takes off the channel | `0.8`", and "Every core a
// removal takes off the channel lowers `pressure` by `0.8` at the moment of the
// removal, clamped the same way." `specs/extraction.md` repeats it for the
// removals themselves: "Every core a removal takes off the channel lowers the
// pressure, as `specs/channel.md` states." So an extraction of n cores pays
// n x 0.8, over and above whatever that tick's rise or bleed comes to.
//
// WHAT ELSE MOVES ON THAT TICK. `specs/channel.md` ("The order of a tick") puts
// the insertion and its extraction at step 3 and the rise or bleed at step 5, so
// the tick's own bleed lands on top of the drop. The channel here carries three
// cores before the shot and one after, both well under `PRESSURE_FREE` (`24`), so
// that term is unambiguously one tick of the `2.0` per second bleed whichever
// count a build reads it from.
//
// THE DRIVE. An isolated hall at level 1 with the quota stopped at 0. Two cores
// of one charge sit on the channel's straight top leg, and the injector is loaded
// with that same charge and fired straight up the field at 270 degrees, which
// `specs/injector.md` carries into a strike and an insertion. The pair is what
// makes the outcome independent of which core is struck and from which side: with
// two same-charge cores spaced by `SPACING`, every one of the four cases
// `specs/injector.md` ("Insertion") allows leaves three same-charge cores spaced
// by `SPACING` in one segment, which is the maximal run of at least 3 that
// `specs/extraction.md` extracts on the insertion. A third core of a DIFFERENT
// charge is posed far behind, so the extraction does not empty the channel and
// trip the clear `specs/progression.md` gives an exhausted quota; it is a
// different charge and a separate segment, so it takes no part in the run.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. The count of cores the removal took is read
// off the build's own snapshots rather than assumed, because how many cores an
// insertion extracts is `insertion`'s and `extraction`'s point to decide, not
// this one. This point decides only that the pressure fell by 0.8 for each core
// that actually left. An extraction has to have happened for there to be anything
// to decide, so a drive that produced none fails here.
//
// THE TOLERANCE. +/- 0.1, as the item's own drive states. That is three ticks'
// worth of the 2.0 per second bleed, so it absorbs a build that applies the
// tick's bleed before the removal, after it, or from either core count, while
// leaving the nearest wrong rule — a flat drop per extraction, or a drop per core
// that is out by one core — 0.8 away, eight times the band.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertNear, assertTrue } from "../assert";
import {
  MIN_RUN,
  OPENING_AIM,
  PRESSURE_BLEED,
  PRESSURE_DROP_PER_CORE,
  PRESSURE_DROP_TOL,
  PRESSURE_FREE,
  TICK_DT,
  type ChargeId,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  fireAt,
  poseHall,
  projectileCount,
  spacedRun,
  topRunS,
  type Harness,
} from "../harness";

/** The charge the pair carries and the injector is loaded with. */
const RUN_CHARGE: ChargeId = "halide";

/** The bystander's charge, different from the pair's so it joins no run. */
const BYSTANDER_CHARGE: ChargeId = "cobalt";

/**
 * The head of the pair, on the channel's straight top leg.
 *
 * The leg runs from the inlet at `(40, 40)` to `(920, 40)`, so an arc position
 * there sits at `x = 40 + s`. The shot leaves the injector's fixed centre
 * `(420, 330)` straight up the field, and the train advances while it flies, so
 * the pair is posed a little short of the shot's line and drifts onto it: at the
 * level-1 feed of 22 under a pressure of 50 the head covers some 14 units before
 * the projectile arrives, which puts it within the 28-unit strike distance
 * `specs/injector.md` fixes. The band is wide — anything from a standing train to
 * one twice this fast still strikes — so a build whose feed speed is wrong fails
 * its own point rather than this one.
 */
const PAIR_HEAD_S = topRunS(412);

/**
 * The bystander, far enough behind the pair that it cannot reach it.
 *
 * It is a segment of its own, so `specs/channel.md` advances it at the fixed
 * catch-up rate of 180 units/s; over the flight it closes to some 160 units short
 * of the pair's tail, which is far more than the `SPACING` a merge needs.
 */
const BYSTANDER_S = 100;

/** Cores on the channel when the shot is fired: the pair and the bystander. */
const POSED_CORES = 3;

/** Long enough for the shot to cross the field; the flight itself is some 28 ticks. */
const MAX_TICKS = 90;

/** A pressure with room to pay a whole run's drop without meeting the clamp at 0. */
const START_PRESSURE = 50;

/** One tick of the bleed, which lands on the same tick as the drop. */
const BLEED_TICK = PRESSURE_BLEED * TICK_DT;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("drops pressure by 0.8 for each core the extraction removed", async () => {
  await poseHall(harness, {
    level: 1,
    quotaRemaining: 0,
    pressure: START_PRESSURE,
    cores: [
      ...spacedRun(PAIR_HEAD_S, [RUN_CHARGE, RUN_CHARGE]),
      ...spacedRun(BYSTANDER_S, [BYSTANDER_CHARGE]),
    ],
    loaded: RUN_CHARGE,
  });
  await fireAt(harness, OPENING_AIM);

  const before = await harness.snapshot();
  const history = await captureReplay(harness, "drop", () =>
    harness.stepWatching(
      MAX_TICKS,
      (snapshot) => coreCount(snapshot) < POSED_CORES,
    ),
  );

  const index = history.length - 1;
  const after = history[index];
  const priorTick = index === 0 ? before : history[index - 1];
  assertTrue(
    after !== undefined && coreCount(after) < POSED_CORES,
    "an extraction the insertion completed, as the run of three the shot makes " +
      "(specs/extraction.md — 'Extraction on an insertion')",
  );

  // The cores the removal took, read off the build's own counts: what stood on
  // the channel, plus the projectile that landed, less what is left.
  const removed =
    coreCount(priorTick) +
    (projectileCount(priorTick) - projectileCount(after)) -
    coreCount(after);
  assertGreaterThanOrEqual(
    removed,
    MIN_RUN,
    "cores taken off the channel by the extraction",
  );

  // Both counts sit under `PRESSURE_FREE`, so the tick's own term is one tick of
  // bleed whichever side of the removal a build reads the count from.
  const expected = removed * PRESSURE_DROP_PER_CORE + BLEED_TICK;
  assertNear(
    priorTick.pressure - after.pressure,
    expected,
    PRESSURE_DROP_TOL,
    `pressure fall across the tick that removed ${removed} core(s), ` +
      `${PRESSURE_DROP_PER_CORE} each plus one tick of bleed ` +
      `(both counts under ${PRESSURE_FREE})`,
  );
});
