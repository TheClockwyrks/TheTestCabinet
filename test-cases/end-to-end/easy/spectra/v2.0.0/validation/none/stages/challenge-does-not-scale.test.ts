// stages/challenge-does-not-scale — a flyover runs at the same speed whenever it
// falls.
//
// specs/stages.md, Scaling: "A challenge stage does not scale. Whatever stage it
// falls on, it runs at the stage-1 figures." Every other scaling point in this group
// grades a figure GOING UP with the stage; this one grades the one stage that is
// exempt, and it is the difference between a flyover that stays a scoring
// opportunity all run long and one that becomes unrakeable by stage 12.
//
// WHY STAGES THREE AND NINE. Both are challenge stages — the schedule is every
// third — and they are far enough apart that a build which scaled them anyway
// reads plainly: `droneSpeedScale` is 1.12 at stage 3 and 1.48 at stage 9, so a
// scaling build's flyover moves 1.32 times as fast at the later one. The stated
// answer is 1.00, and the band below is nowhere near 1.32.
//
// WHAT IS MEASURED. The ground the released group covers per second of game time,
// summed frame by frame along whatever path the build flew and averaged over the
// drones flying it. `specs/stages.md` fixes the SPEED and leaves the path to the
// build, so a reading that compared positions would be grading the path; a rate
// compares the one thing the specification states.
//
// WHY A RATIO RATHER THAN A FIGURE. The requirement is that the late flyover matches
// the early one, so the early one is the reference the late one is read against.
// What the stage-1 figures themselves are is `swarm/entrance-speed`'s point.
//
// WHAT IS DRIVEN. The game's own challenge wave at each stage, left alone. Nothing
// is posed: which drones are moving and how fast is the whole question.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThanOrEqual, fail } from "../assert";
import { CHALLENGE_EVERY } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  seconds,
  startStage,
  type Harness,
} from "../harness";

/** The two challenge stages the flyover is read at. */
const LATE_STAGE = 3 * CHALLENGE_EVERY;
const EARLY_STAGE = CHALLENGE_EVERY;

/** What an unscaled flyover reads: the late speed over the early one. */
const EXPECTED_RATIO = 1;

/**
 * Frames run before the drones flying the flyover are picked out.
 *
 * A fifth of a second. The first group is released as the wave opens, so this is
 * long enough for every drone of it to have moved measurably — 52 units at
 * `ENTER_SPEED` — and short enough that none of them can have crossed the field and
 * left it.
 */
const SETTLE_FRAMES = framesFor(0.2);

/**
 * Frames the speed is measured over.
 *
 * Half a second. At the stated speed that is 130 units of path, a small part of a
 * sweep that crosses the whole 1280-unit field, so neither reading is taken near the
 * start or the end of a path where a build may be easing in or out.
 */
const MEASURE_FRAMES = framesFor(0.5);

/** How far a drone must have moved over the settle to count as flying. */
const MOVED_EPSILON = 0.5;

/**
 * The fewest drones a reading may rest on.
 *
 * One. The specification puts eight in a group, but how many a build has released by
 * the time the settle is over is `stages/challenge-groups`' point rather than this
 * one; what this needs is something moving to measure.
 */
const LEAST_FLYING = 1;

/**
 * How far the measured ratio may sit from 1, as a fraction.
 *
 * Ten per cent. The two legs measure the same thing the same way, so the chord-sum
 * and the frame quantisation fall on both alike and very nearly cancel; what the
 * band really has to absorb is that the two stages need not fly the SAME PATHS —
 * `specs/stages.md` leaves the path to the build and only fixes the speed along it,
 * and a build whose flyover curves differently at one stage than the other reads a
 * slightly different chord sum. Ten per cent covers that with room over, and it is a
 * third of the distance to what a scaling build reads, 1.32.
 */
const TOLERANCE = 0.1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** Units of path a challenge stage's flying drones cover per second, at `stage`. */
async function flyoverRate(h: Harness, stage: number): Promise<number> {
  await h.debug.reset();
  await startStage(h, stage);

  const opened = await h.snapshot();
  await h.advance(SETTLE_FRAMES);
  let previous = await h.snapshot();
  const flying = previous.drones
    .filter((drone) => {
      const was = droneById(opened, drone.id);
      return (
        was !== undefined &&
        Math.hypot(drone.x - was.x, drone.y - was.y) > MOVED_EPSILON
      );
    })
    .map((drone) => drone.id);

  assertGreaterThanOrEqual(
    flying.length,
    LEAST_FLYING,
    `drones of the challenge stage ${stage} flyover in motion, to read a speed from (specs/stages.md)`,
  );

  const travelled = new Map(flying.map((id) => [id, 0]));
  for (let frame = 0; frame < MEASURE_FRAMES; frame += 1) {
    await h.advance(1);
    const now = await h.snapshot();
    for (const id of flying) {
      const was = droneById(previous, id);
      const is = droneById(now, id);
      if (was === undefined || is === undefined) {
        travelled.delete(id);
        continue;
      }
      const so = travelled.get(id);
      if (so !== undefined) {
        travelled.set(id, so + Math.hypot(is.x - was.x, is.y - was.y));
      }
    }
    previous = now;
  }

  const kept = [...travelled.values()];
  if (kept.length === 0) {
    fail(
      `drones of the challenge stage ${stage} flyover still on the field over the reading (specs/stages.md)`,
      "every drone the reading followed had left the field",
    );
  }
  const mean = kept.reduce((sum, value) => sum + value, 0) / kept.length;
  return mean / seconds(MEASURE_FRAMES);
}

it("flies a late challenge stage at the same speed as an early one", async () => {
  const early = await flyoverRate(harness, EARLY_STAGE);
  const late = await flyoverRate(harness, LATE_STAGE);
  await captureStill(harness, "unscaled");

  assertBetween(
    late / early,
    EXPECTED_RATIO * (1 - TOLERANCE),
    EXPECTED_RATIO * (1 + TOLERANCE),
    `the ground a stage-${LATE_STAGE} flyover covers per second over a stage-${EARLY_STAGE} flyover's, which a stage that does not scale leaves at 1 (specs/stages.md)`,
  );
});
