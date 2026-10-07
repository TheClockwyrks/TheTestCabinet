// Deepcore — the miner's movement and its collision against the tile grid
// (specs/character.md).
//
// Gravity pulls the miner down to a load-scaled terminal speed, the jetpack
// pushes it up while thrust is held, lateral input walks and drifts it, and the
// box is kept out of every cell that is not a tunnel. A landing above the safe
// speed reports its speed so the caller can bill the hull. This module applies
// motion alone: the fuel and hull economy and the choice of animation state
// belong to the simulation.
//
// The miner it is handed is the FRAME'S OWN copy, from the draft the frame
// opened, so writing to it never reaches the state the engine published.

import { GRAVITY, MINER_H, MINER_W, WALK_SPEED } from "./constants";
import type { Grid, Miner, MoveInput } from "./game";
import type { MutableMiner } from "./state";
import { colAtX, isSolidKind, rowAtY, tileLeft, tileTop } from "./world";

/** Lateral acceleration toward the walk speed. */
const LATERAL_ACCEL = 2833;

/** Lateral decay with no input: firm on the ground, light in the air. */
const GROUND_FRICTION = 4333;
const AIR_FRICTION = 833;

/** What one update of movement did. */
export interface MoveResult {
  grounded: boolean;
  /** True while the jetpack is firing, which is thrust held with fuel left. */
  thrusting: boolean;
  /** True while drifting laterally in the air, which bills a little fuel. */
  lateralAir: boolean;
  /** Downward speed at the instant of a landing this update, else `0`. */
  landedSpeed: number;
}

/** The column the miner's center falls in. */
export function minerCol(m: Miner): number {
  return colAtX(m.x + MINER_W / 2);
}

/** The row the miner's center falls in. */
export function minerRow(m: Miner): number {
  return rowAtY(m.y + MINER_H / 2);
}

/** World x of the miner's center. */
export function minerCenterX(m: Miner): number {
  return m.x + MINER_W / 2;
}

/** World y of the miner's center. */
export function minerCenterY(m: Miner): number {
  return m.y + MINER_H / 2;
}

/** World y of the miner's feet. */
export function minerFeetY(m: Miner): number {
  return m.y + MINER_H;
}

/** Whether any cell that is not a tunnel overlaps the box. */
export function solidBox(
  grid: Grid,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const c0 = colAtX(x);
  const c1 = colAtX(x + w - 0.001);
  const r0 = rowAtY(y);
  const r1 = rowAtY(y + h - 0.001);
  const cols = grid[0]?.length ?? 0;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      if (c < 0 || c >= cols) return true; // past the sides is a wall
      if (r >= grid.length) return true; // below the floor is a wall
      if (r < 0) continue; // above the camp is open sky, with no ceiling
      if (isSolidKind(grid[r][c].kind)) return true;
    }
  }
  return false;
}

/** Whether the miner is resting on solid ground. */
export function isGrounded(grid: Grid, m: Miner): boolean {
  return solidBox(grid, m.x, m.y + 2, MINER_W, MINER_H);
}

/** Move a value toward a target at a rate, without overshooting it. */
export function ease(
  cur: number,
  target: number,
  rate: number,
  dt: number,
): number {
  return approach(cur, target, rate * dt);
}

function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
}

/**
 * Advance the miner one update.
 *
 * `climbAccel` is the net upward acceleration the jetpack produces at the
 * current load, which gravity does not fight while thrust is held: at the lift
 * limit it is zero, so holding thrust arrests the fall's acceleration and
 * produces no climb. `climbCap` caps the upward speed and `fallCap` the downward
 * one, both load-scaled.
 *
 * With the travel faculty held, the body moves nowhere and its velocity stands,
 * but the miner still reads as grounded and still reports what it is trying to
 * do.
 */
export function stepMovement(
  m: MutableMiner,
  grid: Grid,
  input: MoveInput,
  canThrust: boolean,
  dt: number,
  climbAccel: number,
  climbCap: number,
  fallCap: number,
): MoveResult {
  const grounded0 = isGrounded(grid, m);
  const thrusting = input.thrust && canThrust;
  const targetVx =
    (input.right ? WALK_SPEED : 0) - (input.left ? WALK_SPEED : 0);

  if (!m.travel) {
    return {
      grounded: grounded0,
      thrusting,
      lateralAir: !grounded0 && targetVx !== 0,
      landedSpeed: 0,
    };
  }

  if (targetVx !== 0) {
    m.vx = approach(m.vx, targetVx, LATERAL_ACCEL * dt);
  } else {
    m.vx = approach(m.vx, 0, (grounded0 ? GROUND_FRICTION : AIR_FRICTION) * dt);
  }

  if (thrusting) m.vy -= climbAccel * dt;
  else m.vy += GRAVITY * dt;
  if (m.vy < -climbCap) m.vy = -climbCap;
  if (m.vy > fallCap) m.vy = fallCap;

  m.x += m.vx * dt;
  if (solidBox(grid, m.x, m.y, MINER_W, MINER_H)) {
    if (m.vx > 0) m.x = tileLeft(colAtX(m.x + MINER_W)) - MINER_W - 0.01;
    else if (m.vx < 0) m.x = tileLeft(colAtX(m.x) + 1) + 0.01;
    m.vx = 0;
  }

  const beforeVy = m.vy;
  m.y += m.vy * dt;
  let grounded = false;
  let landedSpeed = 0;
  if (solidBox(grid, m.x, m.y, MINER_W, MINER_H)) {
    if (m.vy > 0) {
      m.y = tileTop(rowAtY(m.y + MINER_H)) - MINER_H - 0.01;
      grounded = true;
      landedSpeed = beforeVy;
    } else if (m.vy < 0) {
      m.y = tileTop(rowAtY(m.y) + 1) + 0.01;
    }
    m.vy = 0;
  }
  // There is no ceiling above the camp, so nothing clamps the rise.

  if (!grounded) grounded = isGrounded(grid, m);

  return {
    grounded,
    thrusting,
    lateralAir: !grounded && targetVx !== 0,
    landedSpeed,
  };
}
