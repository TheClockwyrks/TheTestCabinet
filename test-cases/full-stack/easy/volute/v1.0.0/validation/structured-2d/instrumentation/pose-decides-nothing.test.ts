// Volute — instrumentation/pose-decides-nothing: posing three matching cores
// side by side on the channel extracts nothing on its own. The three stay on the
// channel and the score stays 0 for as long as nothing inserts into them and
// nothing merges into them.
//
// THE RULE THIS DECIDES, and the two spec sentences it rests on:
//
//   specs/extraction.md, "Runs": "A maximal run of at least 3 cores is extracted
//   by the two events below, and a run that reaches 3 cores by any other means
//   stays on the channel." The two events are an insertion resolving and a
//   segment merging with the one ahead of it, and a pose is neither.
//
//   specs/instrumentation.md, "The operations": "No pose decides an outcome
//   either: every insertion, extraction, score, chain step, mark, cell, clear,
//   and ending comes from the ticks run after the pose, so a scenario reads what
//   happened from the snapshot."
//
// WHY IT IS ITS OWN POINT. Every scenario in this project is arranged with
// `poseTrain`, and most of them pose cores of one charge next to each other on
// purpose. A build that extracts a run the moment it is posed makes those
// scenarios impossible to state, and it does so silently — the run vanishes
// during the arrangement, so the check that follows reads an empty channel and
// reports whatever failure that produces rather than this one. This point names
// it directly.
//
// THE ARRANGEMENT. `poseHall` opens level 1, sets the quota remaining to 0, sets
// the pressure to 0, empties the channel, and puts back exactly three halide
// cores at s = 100, 128 and 156 — `SPACING` apart, so
// specs/channel.md's "A **segment** is a maximal run of consecutive cores in the
// train whose arc positions differ by exactly `SPACING`" makes them one segment
// and specs/extraction.md's "A run is a set of consecutive cores of one segment
// that all carry the same charge" makes them one maximal run of three. Nothing
// else stands on the channel, the quota of 0 stops the inlet
// ("While the level's quota is not exhausted, the inlet emits"), and no
// projectile is in flight, so the only two events that could extract the run are
// both out of reach and the run must simply ride.
//
// WHAT IS NOT ASSERTED. How far the three advance in those ticks is
// `channel/feed-advance`; that a run of three IS extracted when an insertion
// completes it is `extraction/extract-three`. What a passing verdict here says is
// only that the arrangement itself decided nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear, assertEachIn } from "../assert";
import { MIN_RUN, SPACING, TICK_DT, TICK_HZ, TICK_TOL } from "../constants";
import {
  captureStill,
  charges,
  coreCount,
  createHarness,
  poseHall,
  seconds,
  spacedBlock,
  type Harness,
} from "../harness";

/**
 * The arc position the frontmost of the three posed cores stands at.
 *
 * Well clear of both ends of the channel: the tail sits at 100 - 2 x SPACING,
 * comfortably past the inlet's emission window, and after the drive below the
 * head is still thousands of units short of the intake at `PATH_LENGTH`. So
 * neither an emission nor a cell spend can reach into the scenario, and the only
 * question left is the one the point asks.
 */
const HEAD_S = 100 + (MIN_RUN - 1) * SPACING;

/**
 * The charge all three carry. One of level 1's own charges
 * (specs/progression.md), so the arrangement is one the level could itself
 * produce.
 */
const CHARGE = "halide";

/**
 * How long the three are left alone: one second of simulated time.
 *
 * Long enough that a build extracting on any tick of an advance is caught rather
 * than a build extracting only at the moment of the pose, and short enough that
 * the head is still far from the intake.
 */
const DRIVE_TICKS = TICK_HZ;

/**
 * How far the accumulated simulated time may sit from the ticks that produced it.
 *
 * The case's standing tolerance on a duration is +/- 2 ticks, expressed in
 * seconds. This reading is the check's guard against passing vacuously: a build
 * whose `step` advanced nothing would leave three cores and a score of 0 too, so
 * the ticks are proved to have really run before the two readings are believed.
 * It is deliberately independent of the advance rule, which another point owns.
 */
const SIM_TIME_TOL = TICK_TOL * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a posed run of three on the channel, and scores nothing", async () => {
  await poseHall(h, {
    level: 1,
    quotaRemaining: 0,
    pressure: 0,
    cores: spacedBlock(HEAD_S, MIN_RUN, CHARGE),
  });

  // Read before any tick runs: the pose itself must have decided nothing, so the
  // three are all there and the score is untouched at the call.
  const posed = h.snapshot();
  assertEqual(
    coreCount(posed),
    MIN_RUN,
    "the cores on the channel the moment the run was posed",
  );
  assertEqual(posed.score, 0, "the score the moment the run was posed");

  const after = await h.step(DRIVE_TICKS);

  // The picture the verdict is read against: the three still riding, a second
  // later.
  captureStill(h, "posed");

  // The ticks really ran, so the two readings below mean something.
  assertNear(
    after.simTime - posed.simTime,
    seconds(DRIVE_TICKS),
    SIM_TIME_TOL,
    `the simulated seconds ${DRIVE_TICKS} ticks covered`,
  );

  // "a run that reaches 3 cores by any other means stays on the channel".
  assertEqual(
    coreCount(after),
    MIN_RUN,
    `the cores on the channel ${DRIVE_TICKS} ticks after the run was posed`,
  );
  assertEachIn(
    charges(after),
    [CHARGE],
    "the charge every core still on the channel carries",
  );
  assertLength(after.segments, 1, "the segments the posed run still rides as");

  // Nothing was extracted, so nothing was paid for and the chain never stepped
  // (specs/extraction.md: an extraction "adds `10 x n x k` to the score", and the
  // chain step rises only on an extraction).
  assertEqual(
    after.score,
    0,
    `the score ${DRIVE_TICKS} ticks after the run was posed`,
  );
  assertEqual(
    after.chainStep,
    1,
    `the chain step ${DRIVE_TICKS} ticks after the run was posed`,
  );
});
