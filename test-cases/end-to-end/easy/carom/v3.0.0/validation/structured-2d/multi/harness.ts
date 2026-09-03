// Carom (Multi-ball) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know what
// every variant has. Multi's specification puts three balls on the field instead
// of one, each with its own hold, its own launch and its own respawn, and this
// module is where the checks below reach that.
//
// A BALL INDEX IS THIS VARIANT'S ALONE. `base` and `gyre` play with one ball and
// none of their ball operations takes an index; multi's every ball operation
// takes `index` FIRST and its snapshot reports the balls as `balls`, each entry
// under its own `index` (specs/instrumentation.md). The shared harness exposes
// that shape as `h.debugMulti`, one object under a second type rather than a
// second object, and {@link multiOps} is where a build that does not actually
// play multi's game is caught before a check drives an index into a single-ball
// operation's first coordinate.
//
// WHAT IS LEFT HERE is what only a multi check needs: the balls read back under
// the shape this variant requires, one ball found by its own index, and the
// sweep a hold is measured with. Nothing parks a spare ball any more — the field
// a check poses holds only the balls its requirement is about, and the rest are
// off the field rather than tucked into a goal channel.
//
// A ball's HOLD is read through what the specification fixes for it: the `held`
// flag its snapshot reports, and the launch its timer times. Each ball carries a
// hold timer of its own (specs/balls.md) and the snapshot reports it, but a
// check about how LONG a hold lasts still counts frames to the launch with
// {@link driveLaunch} rather than reading the timer: the timer is a number the
// build writes, and the launch is the behaviour the case grades.

import { BALL_COUNT, BALL_HOMES, HOLD_TIME } from "../constants";
import { assertEqual, assertTruthy } from "../assert";
import {
  TICK_HZ,
  isMultiBall,
  type BallView,
  type CaromMultiSurface,
  type Harness,
} from "../harness";
import type { CaromSnapshot } from "../surface";

/** The hold, in frames of the harness's clock. */
export const HOLD_TICKS = HOLD_TIME * TICK_HZ;

/**
 * The margin a measured hold is allowed, in frames: one either side, the review
 * items' "within one frame". It covers whether the frame that opened the hold
 * also counted it down (a menu confirm does, specs/ui.md; the frame a point
 * lands on does not, specs/balls.md) and the float rounding of
 * `HOLD_TIME - n * dt`.
 */
export const HOLD_TOLERANCE_TICKS = 1;

/**
 * The surface under the type multi's own specification states for it: `index`
 * first on every ball operation.
 *
 * Not a second surface and not a copy — `h.debug` and `h.debugMulti` are one
 * object under two types. What this adds is the requirement: a build that
 * reports a single `ball` rather than the `balls` array is not playing this
 * variant's game, and it is named here rather than several frames later where a
 * ball index arrived as an `x` coordinate.
 */
export function multiOps(h: Harness): CaromMultiSurface {
  assertEqual(
    isMultiBall(h),
    true,
    "multi requires snapshot().balls, the balls in play order, each under " +
      "its own index (specs/instrumentation.md)",
  );
  return h.debugMulti;
}

/**
 * Every ball a snapshot reports, in play order, under the shape multi requires.
 *
 * Whatever is PRESENT rather than a fixed three: the field a check poses holds
 * only the balls its requirement concerns, so a check that wants all three says
 * so with {@link readEveryBall} and one that isolated a pair reads back a pair.
 */
export function readBalls(snapshot: CaromSnapshot): BallView[] {
  const balls = snapshot.balls;
  assertEqual(
    Array.isArray(balls),
    true,
    "multi requires snapshot().balls, the balls in play order, each under " +
      "its own index (specs/instrumentation.md)",
  );
  return balls as BallView[];
}

/** Every ball a snapshot reports, required to be the whole set of `BALL_COUNT`. */
export function readEveryBall(snapshot: CaromSnapshot): BallView[] {
  const balls = readBalls(snapshot);
  assertEqual(
    balls.length,
    BALL_COUNT,
    `multi plays with ${BALL_COUNT} balls, each present under its own index ` +
      `(specs/balls.md)`,
  );
  return balls;
}

/**
 * The ball at `index`, by the index it reports rather than by where it happens
 * to sit in the array.
 */
export function ballAt(snapshot: CaromSnapshot, index: number): BallView {
  const balls = readBalls(snapshot);
  const found = balls.find(
    (ball, position) => (ball.index ?? position) === index,
  );
  assertTruthy(
    found,
    `ball ${index} must be present on the field, under its own index ` +
      `(specs/instrumentation.md)`,
  );
  return found as BallView;
}

/** What a hold sweep found: whether the ball launched, and after how many frames. */
export interface LaunchResult {
  hit: boolean;
  /** Frames advanced before the sample the ball was first seen in flight in. */
  frames: number;
  snapshot: CaromSnapshot;
}

/**
 * Advance one frame at a time until ball `index` is no longer held, and report
 * the frame it left on.
 *
 * Frame by frame because the count IS the measurement: a coarser poll would
 * report the hold as however long the sweep happened to overshoot it by.
 */
export async function driveLaunch(
  h: Harness,
  index: number,
  maxFrames = 300,
): Promise<LaunchResult> {
  const swept = await h.until((s) => ballAt(s, index).held === false, {
    maxFrames,
    poll: 1,
  });
  return { hit: swept.hit, frames: swept.frames, snapshot: swept.snapshot };
}

/** Whether every ball is waiting at its own home point, motionless. */
export function waitingAtHomes(balls: readonly BallView[]): boolean {
  return balls.every((ball, position) => {
    const home = BALL_HOMES[ball.index ?? position];
    return (
      Math.abs(ball.x - home.x) <= 1 &&
      Math.abs(ball.y - home.y) <= 1 &&
      Math.abs(ball.vx) <= 1 &&
      Math.abs(ball.vy) <= 1
    );
  });
}

/** The angle of a launch from horizontal, in degrees, keeping its direction. */
export function launchAngleDeg(ball: BallView): number {
  return (Math.atan2(ball.vy, ball.vx) * 180) / Math.PI;
}
