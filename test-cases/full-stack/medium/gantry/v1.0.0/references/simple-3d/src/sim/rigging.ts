// The rigging of `specs/rigging.md`: the pendulum the hook and load swing on,
// the cable's tension, attaching a load, and judging a release.

import {
  ATTACH_RADIUS,
  GRAVITY,
  HOIST_CABLE_CAP,
  HOOK_MASS,
  PLACE_POS_TOL,
  PLACE_VEL_TOL,
  PLACE_YAW_TOL,
  SWING_DAMPING,
} from "../constants";
import { DT } from "./axes";
import type { LoadPhase, Pose } from "./types";
import { add, distance, dot, length, scale, sub, type Vec3 } from "./vec";

/** Below this the bob coincides with the pivot and the direction is straight down. */
const COINCIDENT_EPS = 1e-12;

/** The bob: the hook alone, or the hook with the attached load. */
export interface Bob {
  readonly pos: Vec3;
  readonly vel: Vec3;
}

/**
 * The pendulum tick: the seven steps of `specs/rigging.md`, in order.
 *
 * The cable is inextensible, so step 4 puts the bob at exactly `L` from the
 * pivot; the radial part of the velocity relative to the pivot is removed and
 * the tangential part damped, then the pivot's own velocity is added back.
 */
export function pendulumStep(
  bob: Bob,
  pivot: Vec3,
  previousPivot: Vec3,
  cableLength: number,
): Bob {
  // 1. Gravity.
  let v = add(bob.vel, [0, -GRAVITY * DT, 0]);
  // 2. Drift.
  let p = add(bob.pos, scale(v, DT));
  // 3. Constraint direction.
  const offset = sub(p, pivot);
  const dl = length(offset);
  const n: Vec3 = dl < COINCIDENT_EPS ? [0, -1, 0] : scale(offset, 1 / dl);
  // 4. Constraint position.
  p = add(pivot, scale(n, cableLength));
  // 5. Pivot velocity.
  const vp = scale(sub(pivot, previousPivot), 1 / DT);
  // 6. Constraint velocity, relative to the pivot.
  let vr = sub(v, vp);
  vr = sub(vr, scale(n, dot(vr, n)));
  vr = scale(vr, 1 - SWING_DAMPING * DT);
  // 7. Recompose.
  v = add(vp, vr);
  return { pos: p, vel: v };
}

/**
 * The bob's acceleration for the tick, `(v - v_prev) / dt`. On a run's first
 * tick it is zero, whatever velocity the pendulum steps left.
 */
export function bobAcceleration(
  v: Vec3,
  previous: Vec3,
  firstTick: boolean,
): Vec3 {
  if (firstTick) return [0, 0, 0];
  return scale(sub(v, previous), 1 / DT);
}

/** The bob's mass: the hook, plus the attached load's. */
export const bobMass = (attachedMass: number | null): number =>
  HOOK_MASS + (attachedMass ?? 0);

/**
 * The cable's tension vector, `T = m * (a - g)`. The force the rigging applies
 * to the structure at the pivot is `-T`.
 */
export const cableTension = (acceleration: Vec3, mass: number): Vec3 =>
  scale(sub(acceleration, [0, -GRAVITY, 0]), mass);

/** A tick on which `|T|` exceeds `HOIST_CABLE_CAP` snaps the cable. */
export const cableSnaps = (tension: number): boolean =>
  tension > HOIST_CABLE_CAP;

/** One load's run state. */
export interface RunLoad {
  phase: LoadPhase;
  pos: Vec3;
  yaw: number;
}

/**
 * The `attach` candidate: the `waiting` load whose lift point is nearest the
 * hook point, ties going to the one the site lists first, if that distance is
 * at most `ATTACH_RADIUS`. `null` when there is none.
 */
export function attachCandidate(
  loads: readonly RunLoad[],
  hook: Vec3,
): number | null {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < loads.length; i++) {
    if (loads[i].phase !== "waiting") continue;
    const d = distance(loads[i].pos, hook);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  if (best < 0 || bestDistance > ATTACH_RADIUS) return null;
  return best;
}

/**
 * The wrapped difference between two yaws: the shorter way round the circle,
 * never negative and never above `180`.
 */
export function wrappedYawDifference(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}

/** The three set-down tests `release` is judged against. */
export interface ReleaseJudgement {
  readonly placed: boolean;
  readonly positionError: number;
  readonly yawError: number;
  readonly speed: number;
}

export function judgeRelease(
  load: RunLoad,
  target: Pose,
  bobSpeed: number,
): ReleaseJudgement {
  const positionError = distance(load.pos, target.pos);
  const yawError = wrappedYawDifference(load.yaw, target.yaw);
  return {
    placed:
      positionError <= PLACE_POS_TOL &&
      yawError <= PLACE_YAW_TOL &&
      bobSpeed <= PLACE_VEL_TOL,
    positionError,
    yawError,
    speed: bobSpeed,
  };
}
