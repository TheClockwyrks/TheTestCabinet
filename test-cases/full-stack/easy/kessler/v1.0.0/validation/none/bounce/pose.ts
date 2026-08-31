// bounce/pose — the shared poses and readings of the deflector-bounce checks.
//
// Everything here is built from specs/deflector-and-ball.md's bounce ("a
// crossing event": in a tick where a ball's center radius moves "from above
// 194 to 194 or below, with inward radial velocity", and the center angle is
// within the deflector's span) and specs/field.md's angular conventions. Each
// pose stages one ball on a straight world-space line that makes that crossing
// on a known tick over the isolated field, so a validator ticks a fixed count
// and reads exactly one bounce.

import { fail } from "../assert";
import {
  angularOffset,
  ballSpeed,
  DEG,
  ENGLISH_PER_OFFSET_DEG,
  normalizeDeg,
  outwardVelocity,
  PADDLE_CONTACT_RADIUS,
  pointAt,
  polarOf,
  TICK_DT,
} from "../constants";
import { isolate, type Harness, type KesslerSnapshot } from "../harness";

/** One ball of the snapshot's `balls`. */
export type Ball = KesslerSnapshot["balls"][number];

/** Degrees of english per degree of offset, under one cross-engine name. */
export const ENGLISH_PER_OFFSET = ENGLISH_PER_OFFSET_DEG;

/** The wave-`w` ball speed of specs/deflector-and-ball.md. */
export function waveBallSpeed(w: number): number {
  return ballSpeed(w);
}

/**
 * Tolerance in degrees for a bounce posed on a purely radial approach. The
 * ball's center angle never changes on the way in, so the offset, the radial
 * `n`, and the english are identical wherever inside the crossing tick a build
 * reads "the ball's center": only float noise is left.
 */
export const TOL_RADIAL_DEG = 0.1;

/**
 * Tolerance in degrees for a bounce whose approach carries a tangential
 * component. The center then drifts up to ~0.95 degrees of arc inside the
 * crossing tick (240 u/s over 1/60 s at radius ~194), so "the ball's center"
 * — the offset and the `n` of specs/deflector-and-ball.md — is fixed only to
 * the tick, not to a point on it. That drift, plus 1.2x english over it,
 * bounds an honest build's spread under ~2.2 degrees; every defect this suite
 * grades sits several times farther out.
 */
export const TOL_ANGLED_DEG = 2.5;

/** What a pose fixed, for the validator to tick through and reason from. */
export interface BouncePose {
  /** The ball's designed center angle at the end of the crossing tick. */
  thetaDeg: number;
  /** Whole ticks from the pose to the tick the crossing resolves in. */
  ticks: number;
  /** Where the ball was posed. */
  start: { x: number; y: number };
  /** The posed velocity, held until the bounce changes it. */
  velocity: { vx: number; vy: number };
}

/** How the radial pose steers the scenario. */
export interface RadialOptions {
  /** The posed approach speed; the wave-1 figure when omitted. */
  speed?: number;
  /** A wave to put in force (`setWave`) before the ball is posed. */
  wave?: number;
}

/**
 * One ball headed straight down its own radial at `paddleDeg + offsetDeg`,
 * crossing radius 194 on tick 2. Purely radial, so its center angle — and with
 * it the offset and `n` — holds exactly all the way in.
 */
export async function poseRadialApproach(
  h: Harness,
  paddleDeg: number,
  offsetDeg: number,
  options: RadialOptions = {},
): Promise<BouncePose> {
  await isolate(h);
  if (options.wave !== undefined) await h.debug.setWave(options.wave);
  await h.debug.setPaddleAngle(paddleDeg);
  const speed = options.speed ?? ballSpeed(1);
  const thetaDeg = normalizeDeg(paddleDeg + offsetDeg);
  // 1.5 per-tick steps out: tick 1 ends half a step above the contact radius,
  // tick 2 half a step below — a strict crossing, never a posed landing ON it.
  const start = pointAt(
    PADDLE_CONTACT_RADIUS + 1.5 * speed * TICK_DT,
    thetaDeg,
  );
  const velocity = outwardVelocity(speed, thetaDeg, 180);
  await h.debug.spawnBall(start.x, start.y, velocity.vx, velocity.vy);
  return { thetaDeg, ticks: 2, start, velocity };
}

/**
 * One ball whose straight line ends the crossing tick at angle
 * `paddleDeg + offsetDeg`, heading `betaDeg` degrees from the inward radial
 * there (positive toward `+theta`), at the wave-1 speed. The crossing resolves
 * on tick 3, with every earlier tick ending above the contact radius.
 */
export async function poseAngledApproach(
  h: Harness,
  paddleDeg: number,
  offsetDeg: number,
  betaDeg: number,
): Promise<BouncePose> {
  await isolate(h);
  await h.debug.setPaddleAngle(paddleDeg);
  const speed = ballSpeed(1);
  const thetaDeg = normalizeDeg(paddleDeg + offsetDeg);
  const ticks = 3;
  // The tick after the crossing ends half a radial step below the contact
  // radius, at the designed angle exactly.
  const end = pointAt(
    PADDLE_CONTACT_RADIUS - 0.5 * speed * Math.cos(betaDeg * DEG) * TICK_DT,
    thetaDeg,
  );
  // Heading `180 - beta` degrees from the outward radial AT THE CROSSING
  // POINT: inward, with the tangential component toward +theta for positive
  // beta. The ball rides the same world-space line back from there.
  const velocity = outwardVelocity(speed, thetaDeg, 180 - betaDeg);
  const start = {
    x: end.x - ticks * velocity.vx * TICK_DT,
    y: end.y - ticks * velocity.vy * TICK_DT,
  };
  for (let i = 0; i < ticks; i += 1) {
    const at = {
      x: start.x + i * velocity.vx * TICK_DT,
      y: start.y + i * velocity.vy * TICK_DT,
    };
    const { r } = polarOf(at.x, at.y);
    if (r <= PADDLE_CONTACT_RADIUS) {
      fail(
        "an approach wholly above the contact radius before its last tick",
        r,
      );
    }
  }
  await h.debug.spawnBall(start.x, start.y, velocity.vx, velocity.vy);
  return { thetaDeg, ticks, start, velocity };
}

/** The one posed ball, or the failure that says the world is not as posed. */
export function soleBall(snapshot: KesslerSnapshot): Ball {
  const ball = snapshot.balls[0];
  if (snapshot.balls.length !== 1 || ball === undefined) {
    fail("exactly the one posed ball in play", snapshot.balls);
  }
  return ball;
}

/** The world-space direction the ball is heading, in degrees in [0, 360). */
export function ballHeadingDeg(ball: Ball): number {
  return normalizeDeg(Math.atan2(ball.vy, ball.vx) / DEG);
}

/** The ball's speed, in units per second. */
export function ballSpeedOf(ball: Ball): number {
  return Math.hypot(ball.vx, ball.vy);
}

/** The ball's radial speed at its own center: outward positive. */
export function radialSpeedOf(ball: Ball): number {
  const rad = polarOf(ball.x, ball.y).theta * DEG;
  return ball.vx * Math.cos(rad) + ball.vy * Math.sin(rad);
}

/** Assert `actualDeg` is within `tolDeg` of `expectedDeg`, wrap-aware. */
export function assertAngleClose(
  actualDeg: number,
  expectedDeg: number,
  tolDeg: number,
  context?: string,
): void {
  const off = Math.abs(angularOffset(expectedDeg, actualDeg));
  if (!(off <= tolDeg)) {
    const want = `within ${tolDeg} degrees of ${expectedDeg}`;
    fail(context === undefined ? want : `${want} (${context})`, actualDeg);
  }
}
