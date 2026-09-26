// instrumentation/advance-is-exact — `advance(ticks)` runs exactly the ticks it is
// asked for, and an interval of game time reaches the same state however it was
// divided into calls.
//
// THE TWO HALVES ARE THE TWO WAYS A CLOCK GOES WRONG. The first is arithmetic: an
// `advance(n)` that moves the game's own `simTime` by anything but `n x TICK_DT` is
// running the wrong number of ticks, and every duration every other check in this
// project counts is then measured against a clock that lies. The second is the
// STEP: `specs/simulation.md` fixes the timestep at `TICK_HZ` (120) and says the
// simulation "advances in whole ticks and never in a partial one", and
// `specs/instrumentation.md` has `advance(ticks)` run its ticks "immediately and in
// order, each worth exactly one `TICK_DT`". A build that integrates a batch in one
// long step of `n x TICK_DT` satisfies the arithmetic and puts a body somewhere
// else entirely, because the well's pull is read afresh at each tick.
//
// SO THE SECOND HALF IS DECIDED BY A ROCK IN THE WELL, POSED TWICE. The same rock,
// from the same place, at the same velocity, is carried a second of game time — once
// as ONE call and once as a hundred and twenty single-tick calls — and the two
// landings are held against each other. Nothing about the build's own idea of where
// a rock should end up enters the comparison: what is compared is the build against
// itself, which is exactly what "however it was divided into frames" means.
//
// The rock is posed 412 units from the star, where the pull is gentle and the
// scenario is a smooth curve rather than a whip around the core, and the field is
// empty but for it, so nothing it could collide with can end the leg early.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { TICK_DT } from "../constants";
import {
  captureReplay,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
  type RockView,
} from "../harness";

/** The tick counts a single `advance` call is asked for, smallest first. */
const BATCHES = [1, 7, ticksFor(1)] as const;

/**
 * How far `simTime` may sit from the game time a call asked for, in seconds.
 *
 * One whole tick, which is the bound the review item states. It is loose on
 * purpose at this end — the reading it defends is that a build does not run a
 * BATCH of ticks it was never asked for — and the leg below closes the gap, since a
 * build that drops or adds a tick per call reaches a visibly different state when
 * the same second is spent one tick at a time.
 */
const CLOCK_TOLERANCE = TICK_DT;

/**
 * How far the two landings may sit apart, in seconds.
 *
 * A microsecond: both routes add `TICK_DT` a hundred and twenty times, so nothing
 * but the last bits of a double separates them. A build that computes a batch as
 * one multiplication instead lands within this too, which is why the position
 * below is the leg that decides the item.
 */
const CLOCK_AGREEMENT = 1e-6;

/**
 * How far the two landings may sit apart, in logical units.
 *
 * A hundredth of a unit. Two runs of the same hundred and twenty ticks agree to
 * floating-point rounding, which is many orders below this; a build that integrated
 * the second as ONE step of one second reads the well once instead of a hundred and
 * twenty times and puts the rock tens of units away, which is thousands of times
 * this bound.
 */
const LANDING_TOLERANCE = 0.01;

/** Where the rock is posed: 412 units from the star, where the pull is gentle. */
const ROCK_PLACE = { x: 320, y: 620 } as const;
/** The velocity it carries, so the leg reads a curve rather than a straight fall. */
const ROCK_VELOCITY = { vx: 90, vy: -60 } as const;

/** The game time each of the two routes covers. */
const SPAN_TICKS = ticksFor(1);

/** The game time the recording runs on past the reading, so the clip has an end. */
const TAIL_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the clock by exactly the ticks a call asks for", async () => {
  await startPlaying(h);
  for (const ticks of BATCHES) {
    const before = (await h.snapshot()).simTime;
    // One call of `advance(ticks)`, which is what `skip` is: the harness's
    // `advance` would spend the same game time as `ticks` separate calls.
    await h.skip(ticks);
    const after = (await h.snapshot()).simTime;
    assertLessThanOrEqual(
      Math.abs(after - before - ticks * TICK_DT),
      CLOCK_TOLERANCE,
      `advance(${ticks}) moved simTime by ${ticks} x TICK_DT`,
    );
  }
});

it("reaches the same state whether a second is one call or a hundred and twenty", async () => {
  await startPlaying(h);

  // The batch: one `advance(120)`, off camera.
  await h.debug.clearRocks();
  const batchedId = await poseRock(
    h,
    "medium",
    ROCK_PLACE.x,
    ROCK_PLACE.y,
    ROCK_VELOCITY.vx,
    ROCK_VELOCITY.vy,
  );
  const batchOpened = (await h.snapshot()).simTime;
  await h.skip(SPAN_TICKS);
  const batchClosed = await h.snapshot();
  const batched = requireRock(batchClosed, batchedId, "the batched rock");

  // The same rock, from the same place, one tick at a time — and this half is what
  // the recording holds, with half a second of the drift running on past the
  // reading so the clip ends on the curve rather than on the measurement.
  await h.debug.clearRocks();
  const steppedId = await poseRock(
    h,
    "medium",
    ROCK_PLACE.x,
    ROCK_PLACE.y,
    ROCK_VELOCITY.vx,
    ROCK_VELOCITY.vy,
  );
  const stepOpened = (await h.snapshot()).simTime;
  const stepped = await captureReplay(
    h,
    "advance",
    async (): Promise<{ rock: RockView; simTime: number }> => {
      await h.advance(SPAN_TICKS);
      const closed = await h.snapshot();
      const rock = requireRock(closed, steppedId, "the single-stepped rock");
      await h.advance(TAIL_TICKS);
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
