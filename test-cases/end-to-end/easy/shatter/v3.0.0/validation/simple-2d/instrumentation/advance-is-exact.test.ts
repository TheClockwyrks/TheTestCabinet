// instrumentation/advance-is-exact — an advance moves the game's own clock by
// exactly the game time it delivers, and an interval of game time reaches the same
// state however it was divided into calls.
//
// THE TWO HALVES ARE THE TWO WAYS A CLOCK GOES WRONG.
//
//   1. ARITHMETIC. `specs/simulation.md` fixes the timestep at `TICK_HZ` (120) and
//      says the simulation "advances in whole ticks and never in a partial one",
//      and `specs/instrumentation.md` has `simTime` accumulate "every tick's
//      `TICK_DT`, whatever the screen". The harness supplies a `ConstantClock` of
//      exactly one `TICK_DT`, so `n` advanced frames are `n` ticks of game time —
//      and a build whose accumulator forces a minimum step, drops the remainder, or
//      counts `simTime` in frames rather than in ticks reports a different number.
//      Every duration every other check in this project counts is measured against
//      that clock, so a build that gets this wrong makes a liar of all of them.
//   2. THE DIVISION. `specs/simulation.md` requires the delta a frame brings to be
//      "converted into whole ticks with the remainder carried into the next frame",
//      so the same interval reaches the same state however the caller grouped its
//      frames. Under this engine the grouping is `engine.advance`'s: one call of a
//      hundred and twenty frames, or a hundred and twenty calls of one, deliver the
//      same hundred and twenty deltas, and a build whose state transition depends
//      on anything but the deltas it was handed lands somewhere else.
//
// THE SECOND HALF IS DECIDED BY A ROCK IN THE WELL, POSED TWICE. The same rock,
// from the same place, at the same velocity, is carried a second of game time —
// once as ONE call and once as a hundred and twenty single-frame calls — and the
// two landings are held against each other. Nothing about the build's own idea of
// where a rock should end up enters the comparison: what is compared is the build
// against itself, which is exactly what "however it was divided" means.
//
// The rock is posed 412 units from the star, where the pull is gentle and the
// scenario is a smooth curve rather than a whip around the core, and the field is
// empty but for it, so nothing it could collide with can end the leg early.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT } from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseRock,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import type { RockSnapshot } from "../surface";

/** The frame counts a single `advance` call is asked for, smallest first. */
const BATCHES = [1, 7, ticksFor(1)] as const;

/**
 * How far `simTime` may sit from the game time a call delivered, in seconds.
 *
 * One whole tick, which is the bound the review item states. It is loose on
 * purpose at this end — the reading it defends is that a build does not run a
 * BATCH of ticks it was never handed the time for — and the leg below closes the
 * gap, since a build that drops or adds a tick per call reaches a visibly
 * different state when the same second is spent one frame at a time.
 */
const CLOCK_TOLERANCE = TICK_DT;

/**
 * How far the two landings' clocks may sit apart, in seconds.
 *
 * A microsecond: both routes add `TICK_DT` a hundred and twenty times, so nothing
 * but the last bits of a double separates them.
 */
const CLOCK_AGREEMENT = 1e-6;

/**
 * How far the two landings may sit apart, in logical units.
 *
 * A hundredth of a unit. Two runs of the same hundred and twenty ticks agree to
 * floating-point rounding, which is many orders below this; a build whose state
 * transition read anything but the delta — a frame counter, a wall clock, the size
 * of the batch it was in — moves the rock by whole units at the drift speeds
 * `specs/rocks.md` fixes, which is hundreds of times this bound.
 */
const LANDING_TOLERANCE = 0.01;

/** Where the rock is posed: 412 units from the star, where the pull is gentle. */
const ROCK_PLACE = { x: 320, y: 620 } as const;
/** The velocity it carries, so the leg reads a curve rather than a straight fall. */
const ROCK_VELOCITY = { vx: 90, vy: -60 } as const;

/** The game time each of the two routes covers. */
const SPAN_FRAMES = ticksFor(1);

/** The game time the recording runs on past the reading, so the clip has an end. */
const TAIL_FRAMES = ticksFor(0.5);

let h: Harness;

/** Pose the one rock this scenario is about on an emptied field, and answer its id. */
function poseTheRock(): number {
  h.debug.clearRocks();
  return poseRock(
    h,
    "medium",
    ROCK_PLACE.x,
    ROCK_PLACE.y,
    ROCK_VELOCITY.vx,
    ROCK_VELOCITY.vy,
  );
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves the clock by exactly the game time a call delivers", async () => {
  startPlaying(h);
  for (const frames of BATCHES) {
    const before = h.snapshot().simTime;
    await h.advance(frames);
    const after = h.snapshot().simTime;
    assertLessThanOrEqual(
      Math.abs(after - before - frames * TICK_DT),
      CLOCK_TOLERANCE,
      `advance(${frames}) moved simTime by ${frames} x TICK_DT`,
    );
  }
});

it("reaches the same state whether a second is one call or a hundred and twenty", async () => {
  startPlaying(h);

  // The batch: one `advance(120)`, off camera.
  const batchedId = poseTheRock();
  const batchOpened = h.snapshot().simTime;
  await h.advance(SPAN_FRAMES);
  const batchClosed = h.snapshot();
  const batched = rockById(batchClosed, batchedId, "the batched rock");

  // The same rock, from the same place, one frame at a time — and this half is
  // what the recording holds, with half a second of the drift running on past the
  // reading so the clip ends on the curve rather than on the measurement.
  const steppedId = poseTheRock();
  const stepOpened = h.snapshot().simTime;
  const stepped = await captureReplay(
    h,
    "advance",
    async (): Promise<{ rock: RockSnapshot; simTime: number }> => {
      for (let frame = 0; frame < SPAN_FRAMES; frame += 1) await h.advance(1);
      const closed = h.snapshot();
      const rock = rockById(closed, steppedId, "the single-stepped rock");
      await h.advance(TAIL_FRAMES);
      return { rock, simTime: closed.simTime };
    },
  );

  assertLessThanOrEqual(
    Math.abs(
      stepped.simTime - stepOpened - (batchClosed.simTime - batchOpened),
    ),
    CLOCK_AGREEMENT,
    "the game time one call and a hundred and twenty calls each covered",
  );
  assertLessThanOrEqual(
    Math.abs(stepped.rock.x - batched.x),
    LANDING_TOLERANCE,
    "where the rock landed, x",
  );
  assertLessThanOrEqual(
    Math.abs(stepped.rock.y - batched.y),
    LANDING_TOLERANCE,
    "where the rock landed, y",
  );
  assertLessThanOrEqual(
    Math.abs(stepped.rock.vx - batched.vx),
    LANDING_TOLERANCE,
    "the velocity it landed with, vx",
  );
  assertLessThanOrEqual(
    Math.abs(stepped.rock.vy - batched.vy),
    LANDING_TOLERANCE,
    "and vy",
  );
});
