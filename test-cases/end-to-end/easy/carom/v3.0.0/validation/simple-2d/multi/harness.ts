// Carom (Multi-ball) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know what
// every variant has. Multi's specification puts three balls on the field instead
// of one, each with its own hold, its own launch and its own respawn, and this
// module is where the checks below reach that.
//
// The shared harness already reads the ball a shared scenario drives through
// `ball0`, and already puts the other two out of the way through `parkSpares`,
// so what is left here is what only a multi check needs: the whole array, the
// home points, a pair of parks on the other side of the field for the one
// scenario that sends a ball out of the LEFT goal, and the sweep a hold is
// measured with.
//
// The narrowing is safe by construction: these checks only ever run against a
// multi build, whose specification requires exactly what is read here.

import {
  BALL_COUNT,
  BALL_HOMES,
  BALL_R,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
} from "../constants";
import { assertEqual } from "../assert";
import { TICK_HZ, allBalls, type BallView, type Harness } from "../harness";
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
 * Where a scenario that drives a ball out of the LEFT goal parks the spares.
 *
 * `SPARE_PARKS` in the shared harness puts them in the left goal channel, which is the corner of
 * the field nothing crosses — until a check deliberately sends a ball out of that
 * goal. These are the same two corners on the other side.
 */
export const RIGHT_PARKS: readonly { x: number; y: number }[] = [
  { x: FIELD_W - BALL_R - 2, y: BALL_R + 2 },
  { x: FIELD_W - BALL_R - 2, y: FIELD_H - BALL_R - 2 },
];

/** Ball `index`'s own hold timer, read off the state the build declared. */
export function holdTimerOf(h: Harness, index: number): number {
  const balls = (h.state as unknown as { balls?: { holdTimer: number }[] })
    .balls;
  assertEqual(
    typeof balls?.[index]?.holdTimer,
    "number",
    "multi requires each ball's `holdTimer` on the state (specs/state.md)",
  );
  return (balls as { holdTimer: number }[])[index].holdTimer;
}

/** Every ball a snapshot reports, checked for count before a check reads them. */
export function readBalls(snapshot: CaromSnapshot): BallView[] {
  const balls = allBalls(snapshot);
  assertEqual(
    balls.length,
    BALL_COUNT,
    "multi requires snapshot().balls, the three balls in play order " +
      "(specs/instrumentation.md)",
  );
  return balls;
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
  const swept = await h.until((s) => readBalls(s)[index].held === false, {
    maxFrames,
    poll: 1,
  });
  return { hit: swept.hit, frames: swept.frames, snapshot: swept.snapshot };
}

/** Whether every ball is waiting at its own home point, motionless. */
export function waitingAtHomes(balls: readonly BallView[]): boolean {
  return balls.every((ball, index) => {
    const home = BALL_HOMES[index];
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
