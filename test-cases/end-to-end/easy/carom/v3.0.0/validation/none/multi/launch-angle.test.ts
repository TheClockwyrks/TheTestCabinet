// multi/launch-angle — a launch takes a fresh angle drawn over the full circle,
// not one aimed at a receiver.
//
// A single reading cannot say this: any one launch has some angle, and a build
// that always fires flat at the player who was just scored on would produce a
// perfectly respectable one. So the match is opened under a series of seeds and
// every ball's launch is read, giving a sample of the distribution rather than a
// point on it. The seed is set AFTER the match is opened, because opening one
// restores every declared field including the seed and the generator's state.
//
// Each match is posed the same way: the field cleared back to the three balls
// this point is about, each on its own home with a full timer, and every hold cut
// short so the build's own rule performs the three launches. Nothing else is on
// the field, so what the recording shows is three balls leaving three home points
// on three unrelated headings and nothing they could have been deflected by.
//
// What the sample is held to is what `specs/balls.md` fixes and nothing more: the
// angle is uniform over the WHOLE circle, so launches go both ways across the
// field, most of them are nowhere near horizontal, and each is drawn afresh. The
// bounds below are generous against a uniform draw and unreachable by a build
// that aims its launches.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLength,
  assertLessThanOrEqual,
} from "../assert";
import { BALL_COUNT, SERVE_SPEED } from "../constants";
import {
  captureReplay,
  createMultiHarness,
  endHolds,
  openCountdown,
  type MultiHarness,
} from "../harness";
import { isolateBalls, launchAngleDeg, readBalls } from "./harness";

/** The seeds the sample is drawn under, one match each. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** How far off the specified launch speed a launch may be, in units per second. */
const SPEED_TOLERANCE = SERVE_SPEED * 0.01;

/**
 * The band the steep launches are counted outside of, in degrees from
 * horizontal: the review item's figure.
 */
const FLAT_DEG = 30;

/**
 * How much of the sample must fall outside that band, and how many launches must
 * go each way across the field.
 *
 * A uniform draw over the circle puts two thirds of its launches outside a
 * +/-30 degree band, 16 of the 24 here, and half of them each way. A third
 * outside the band is what the review item asks, and a uniform draw falls short
 * of it about one time in ten thousand; one launch each way is what "both
 * directions" means, and a uniform draw misses that one time in eight million.
 * A build that serves flat, or always toward one side, fails both.
 */
const STEEP_MIN = 8;
const EACH_WAY_MIN = 1;

/**
 * How far apart two launches of one match must be, in degrees, to be different
 * draws rather than one angle shared: a hundredth of a degree is far below any
 * resolution a generator would be drawn at.
 */
const SHARED_DEG = 0.01;

/** Frames of the launched flight recorded for the reviewer's clip. */
const FLIGHT_TICKS = 90; // 0.75 s

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Open a match under `seed` on a field holding the three balls alone. */
async function openSeededMatch(seed: number): Promise<void> {
  await openCountdown(h, "versus");
  await h.debug.setSeed(seed);
  await isolateBalls(h);
}

/** Open a match under `seed`, cut the holds short, and read all three launches. */
async function launchesUnder(
  seed: number,
): Promise<{ speed: number; vx: number; angle: number }[]> {
  await openSeededMatch(seed);
  await endHolds(h);
  const launched = await h.until((s) => readBalls(s).every((b) => !b.held), {
    maxFrames: 20,
    poll: 1,
  });
  assertEqual(launched.hit, true);
  const balls = readBalls(launched.snapshot);
  assertLength(balls, BALL_COUNT);
  return balls.map((ball) => ({
    speed: ball.speed,
    vx: ball.vx,
    angle: launchAngleDeg(ball),
  }));
}

it("draws every launch over the whole circle rather than aiming it", async () => {
  const launches: { speed: number; vx: number; angle: number }[] = [];
  for (const seed of SEEDS) {
    const match = await launchesUnder(seed);
    // Each launch is its own draw: no two balls of one match share an angle.
    for (let i = 0; i < match.length; i += 1) {
      for (let j = i + 1; j < match.length; j += 1) {
        assertGreaterThan(
          Math.abs(match[i].angle - match[j].angle),
          SHARED_DEG,
          `seed ${seed}: balls ${i} and ${j} share a launch angle`,
        );
      }
    }
    launches.push(...match);
  }

  // Every one of them is a launch: the angle varies, the speed does not.
  for (const launch of launches) {
    assertLessThanOrEqual(
      Math.abs(launch.speed - SERVE_SPEED),
      SPEED_TOLERANCE,
    );
  }

  const steep = launches.filter(
    (launch) =>
      Math.abs(launch.angle) > FLAT_DEG &&
      Math.abs(launch.angle) < 180 - FLAT_DEG,
  );
  assertGreaterThanOrEqual(steep.length, STEEP_MIN);

  // Both ways across the field: a launch is not aimed at a receiver.
  assertGreaterThanOrEqual(
    launches.filter((launch) => launch.vx > 0).length,
    EACH_WAY_MIN,
  );
  assertGreaterThanOrEqual(
    launches.filter((launch) => launch.vx < 0).length,
    EACH_WAY_MIN,
  );

  // One opening, kept for the reviewer: three balls leaving their home points on
  // three unrelated headings.
  await openSeededMatch(SEEDS[0]);
  await captureReplay(h, "launch", async () => {
    await endHolds(h);
    await h.advance(FLIGHT_TICKS);
  });
});
