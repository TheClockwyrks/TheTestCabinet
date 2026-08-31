// Lives — the shared poses of the life-loss checks. CASE-PROVIDED.
//
// specs/field.md fixes the event every check in this category watches: "After
// step 5, if this tick's burn-ups removed the last live ball, one life is
// lost: `lives` falls by `1`, and every timed effect, the shield, and every
// pod are cleared. With lives remaining, a new ball parks on the deflector as
// `specs/deflector-and-ball.md` states. At zero lives the game moves to the
// `gameover` screen." The helpers here only stage the balls that force or
// avoid that event — no helper asserts, so every verdict is a validator's own.

import { polarOf } from "../constants";
import { spawnBallPolar, type Harness } from "../harness";
import type { BallSnapshot } from "../surface";

export {
  PADDLE_START_ANGLE as DEFLECTOR_START_DEG,
  PADDLE_SPAN_BASE as BASE_SPAN_DEG,
  SERVE_RADIUS as PARK_RADIUS,
  WIDEN_SPAN as WIDEN_SPAN_DEG,
  WIDEN_TICKS as WIDEN_POSE_TICKS,
  PIERCE_TICKS as PIERCE_POSE_TICKS,
} from "../constants";

/**
 * The meridian the doomed ball falls down: opposite the deflector's starting
 * 90, so nothing it passes belongs to another check.
 */
export const DOOM_THETA = 270;

/** How fast the doomed ball falls, units per second. */
export const DOOM_SPEED = 240;

/**
 * How long a check waits for a fall from the default radius to burn up: the
 * 18 ticks the fall takes, with slack for a build whose crossing lands a tick
 * or two away.
 */
export const DOOM_TICKS = 40;

/**
 * Spawn one ball at radius `r` and angle `thetaDeg` moving purely radially:
 * `radialSpeed` positive outward, negative inward, units per second.
 */
export async function spawnBallRadial(
  h: Harness,
  r: number,
  thetaDeg: number,
  radialSpeed: number,
): Promise<void> {
  await spawnBallPolar(
    h,
    r,
    thetaDeg,
    Math.abs(radialSpeed),
    radialSpeed < 0 ? 180 : 0,
  );
}

/**
 * Spawn the ball whose burn-up a check watches: radially inward at
 * {@link DOOM_SPEED} from radius `r`, down the {@link DOOM_THETA} meridian.
 * From the default 150 it starts below every ring band and the deflector's
 * contact radius, so the burn-up threshold is the only surface it can cross.
 */
export async function spawnDoomedBall(h: Harness, r = 150): Promise<void> {
  await spawnBallRadial(h, r, DOOM_THETA, -DOOM_SPEED);
}

/** One snapshot ball's polar position. */
export function ballPolar(ball: BallSnapshot): { r: number; theta: number } {
  return polarOf(ball.x, ball.y);
}
