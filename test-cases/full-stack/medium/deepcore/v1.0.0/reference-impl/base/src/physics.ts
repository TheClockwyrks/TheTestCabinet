// Deepcore — the miner's physics (specs/character.md, specs/controls.md).
//
// A fixed-timestep integration: gravity pulls the miner down to a terminal speed, the
// jetpack thrusts up (the only way to gain height), lateral input walks/drifts, and a
// single-tile grid collision keeps the miner out of solid rock, bedrock, and lava. A
// landing faster than a safe threshold reports its impact speed so the caller can bill
// hull damage (specs/hazards.md). This module applies forces and resolves collision; the
// fuel/hull economy and the animation-state choice live in game.ts.

import { FALL_TERMINAL, GRAVITY, THRUST_CLIMB, TILE_SIZE, WALK_SPEED } from "./constants";
import type { Miner, Tile } from "./types";
import { colAtX, isSolidKind, rowAtY, tileLeft, tileTop } from "./world";

/** Collision box (a little narrower than a tile so a one-tile-wide tunnel is passable). */
export const MINER_W = 34;
export const MINER_H = 44;

/** How hard the jetpack pushes up, above gravity, for a snappy climb. */
const THRUST_FORCE = GRAVITY + 1700;
/** Lateral acceleration toward the walk speed. */
const LATERAL_ACCEL = 1700;
/** Velocity decay when no lateral input (px/s^2): strong on the ground, light in air. */
const GROUND_FRICTION = 2600;
const AIR_FRICTION = 500;

export interface MoveInput {
  left: boolean;
  right: boolean;
  down: boolean;
  thrust: boolean;
}

export interface MoveResult {
  grounded: boolean;
  /** True while the jetpack is actually firing (thrust held with fuel). */
  thrusting: boolean;
  /** True while drifting laterally in the air (bills a little fuel). */
  lateralAir: boolean;
  /** Downward speed at the instant of a hard landing this tick, else 0. */
  landedSpeed: number;
}

/** Center column/row of the miner (the cell it occupies). */
export function minerCol(m: Miner): number {
  return colAtX(m.x + MINER_W / 2);
}
export function minerRow(m: Miner): number {
  return rowAtY(m.y + MINER_H / 2);
}

/** Whether any solid tile overlaps the box [x, x+w] × [y, y+h]. */
export function solidBox(grid: Tile[][], x: number, y: number, w: number, h: number): boolean {
  const c0 = colAtX(x);
  const c1 = colAtX(x + w - 0.001);
  const r0 = rowAtY(y);
  const r1 = rowAtY(y + h - 0.001);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (c < 0 || c >= grid[0]!.length) return true; // off the sides = wall
      if (r >= grid.length) return true; // below the world floor = wall
      if (r < 0) continue; // above the world top = OPEN SKY, no ceiling (specs/character.md)
      if (isSolidKind(grid[r]![c]!.kind)) return true;
    }
  }
  return false;
}

function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  if (cur > target) return Math.max(cur - maxDelta, target);
  return cur;
}

/**
 * Advance the miner one fixed step under gravity/thrust/lateral input and resolve grid
 * collision. `canThrust` gates the jetpack on remaining fuel (specs/character.md).
 */
export function stepMovement(m: Miner, grid: Tile[][], input: MoveInput, canThrust: boolean, dt: number): MoveResult {
  // --- Horizontal intent ---
  const targetVx = (input.right ? WALK_SPEED : 0) - (input.left ? WALK_SPEED : 0);
  const groundedNow = solidBox(grid, m.x, m.y + 2, MINER_W, MINER_H);
  if (targetVx !== 0) {
    m.vx = approach(m.vx, targetVx, LATERAL_ACCEL * dt);
  } else {
    m.vx = approach(m.vx, 0, (groundedNow ? GROUND_FRICTION : AIR_FRICTION) * dt);
  }

  // --- Vertical intent ---
  m.vy += GRAVITY * dt;
  const thrusting = input.thrust && canThrust;
  if (thrusting) m.vy -= THRUST_FORCE * dt;
  if (m.vy < -THRUST_CLIMB) m.vy = -THRUST_CLIMB;
  if (m.vy > FALL_TERMINAL) m.vy = FALL_TERMINAL;

  // --- Horizontal collision ---
  m.x += m.vx * dt;
  if (solidBox(grid, m.x, m.y, MINER_W, MINER_H)) {
    if (m.vx > 0) {
      m.x = tileLeft(colAtX(m.x + MINER_W)) - MINER_W - 0.01;
    } else if (m.vx < 0) {
      m.x = tileLeft(colAtX(m.x) + 1) + 0.01;
    }
    m.vx = 0;
  }

  // --- Vertical collision ---
  const preVy = m.vy;
  m.y += m.vy * dt;
  let grounded = false;
  let landedSpeed = 0;
  if (solidBox(grid, m.x, m.y, MINER_W, MINER_H)) {
    if (m.vy > 0) {
      m.y = tileTop(rowAtY(m.y + MINER_H)) - MINER_H - 0.01;
      grounded = true;
      landedSpeed = preVy;
    } else if (m.vy < 0) {
      m.y = tileTop(rowAtY(m.y) + 1) + 0.01;
    }
    m.vy = 0;
  }
  // No ceiling above the surface (specs/character.md): the miner may thrust up into the
  // open sky as far as its fuel lasts, wasting fuel, then fall back down. Nothing clamps
  // its rise — the only limit is the fuel it burns getting there.

  if (!grounded) grounded = solidBox(grid, m.x, m.y + 2, MINER_W, MINER_H);

  const lateralAir = !grounded && targetVx !== 0;
  return { grounded, thrusting, lateralAir, landedSpeed };
}

/** World-space center of the miner (for camera, particles, scanner). */
export function minerCenterX(m: Miner): number {
  return m.x + MINER_W / 2;
}
export function minerCenterY(m: Miner): number {
  return m.y + MINER_H / 2;
}

/** Snap-toward helper the drill uses to brace the miner to a column/row while cutting. */
export function ease(cur: number, target: number, rate: number, dt: number): number {
  return approach(cur, target, rate * dt);
}

/** The world-y a miner standing on the surface floor rests at (feet on top of row 1). */
export const SURFACE_FEET_Y = TILE_SIZE;
