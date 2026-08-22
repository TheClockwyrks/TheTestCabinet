// multi/launch-angle — a launch takes a fresh angle drawn over the full circle,
// not one aimed at a receiver.
//
// A single reading cannot say this: any one launch has some angle, and a build
// that always fires flat at the player who was just scored on would produce a
// perfectly respectable one. So the match is opened under a series of seeds and
// every ball's launch is read, giving a sample of the distribution rather than a
// point on it.
//
// What the sample is held to is what `specs/balls.md` fixes and nothing more: the
// angle is uniform over the WHOLE circle, so launches go both ways across the
// field, most of them are nowhere near horizontal, and each is drawn afresh. The
// bounds below are generous against a uniform draw and unreachable by a build
// that aims its launches.

import { afterEach, beforeEach, expect, it } from "vitest";
import { SERVE_SPEED } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { launchAngleDeg, readBalls } from "./harness";

/** The seeds the sample is drawn under, one match each. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** How far off the specified launch speed a launch may be, in units per second. */
const SPEED_TOLERANCE = SERVE_SPEED * 0.15;

/**
 * The band a single-ball serve is confined to, in degrees.
 *
 * Stated here rather than imported, because it is the OTHER variants' figure: a
 * receiver-directed serve leaves within 30 degrees of horizontal. It is the
 * yardstick this point is measured against — a multi launch is drawn over the
 * whole circle, so most of them fall outside it.
 */
const FLAT_DEG = 30;

/**
 * How much of the sample must fall outside that band, and how many launches must
 * go each way across the field.
 *
 * A uniform draw over the circle puts two thirds of its launches outside a
 * +/-30 degree band — 16 of the 24 here — and half of them each way. These bounds
 * are half of that, so a genuinely uniform build clears them comfortably while a
 * build that serves flat, or always toward one side, cannot.
 */
const STEEP_MIN = 8;
const EACH_WAY_MIN = 4;

/** How many launches must differ from every other, to the degree. */
const DISTINCT_MIN = 12;

/** Frames of the launched flight recorded for the reviewer's clip. */
const FLIGHT_TICKS = 90; // 0.75 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Open a match under `seed`, cut the hold short, and read all three launches. */
async function launchesUnder(
  seed: number,
): Promise<{ speed: number; vx: number; angle: number }[]> {
  await h.debug.reset({ seed });
  await h.debug.startMatch("versus");
  await h.debug.serve();
  const launched = await h.until((s) => readBalls(s).every((b) => !b.held), {
    maxFrames: 20,
    poll: 1,
  });
  expect(launched.hit).toBe(true);
  return readBalls(launched.snapshot).map((ball) => ({
    speed: ball.speed,
    vx: ball.vx,
    angle: launchAngleDeg(ball),
  }));
}

it("draws every launch over the whole circle rather than aiming it", async () => {
  const launches: { speed: number; vx: number; angle: number }[] = [];
  for (const seed of SEEDS) launches.push(...(await launchesUnder(seed)));

  // Every one of them is a launch: the angle varies, the speed does not.
  for (const launch of launches) {
    expect(Math.abs(launch.speed - SERVE_SPEED)).toBeLessThanOrEqual(
      SPEED_TOLERANCE,
    );
  }

  const steep = launches.filter(
    (launch) =>
      Math.abs(launch.angle) > FLAT_DEG &&
      Math.abs(launch.angle) < 180 - FLAT_DEG,
  );
  expect(steep.length).toBeGreaterThanOrEqual(STEEP_MIN);

  // Both ways across the field: a launch is not aimed at a receiver.
  expect(
    launches.filter((launch) => launch.vx > 0).length,
  ).toBeGreaterThanOrEqual(EACH_WAY_MIN);
  expect(
    launches.filter((launch) => launch.vx < 0).length,
  ).toBeGreaterThanOrEqual(EACH_WAY_MIN);

  // And each is drawn afresh rather than cycled through a fixed set.
  const distinct = new Set(launches.map((launch) => Math.round(launch.angle)));
  expect(distinct.size).toBeGreaterThanOrEqual(DISTINCT_MIN);

  // One opening, kept for the reviewer: three balls leaving their home points on
  // three unrelated headings.
  await h.debug.reset({ seed: SEEDS[0] });
  await h.debug.startMatch("versus");
  await captureReplay(h, "launch", async () => {
    await h.debug.serve();
    await h.advance(FLIGHT_TICKS);
  });
});
