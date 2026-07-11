/**
 * Sunfront — planar math helpers.
 *
 * Gameplay runs on the logical `(x, z)` ground plane (specs/playfield.md); the
 * advance axis is the main diagonal from `(0,0)` to `(1200,1200)` and the battle is
 * a corridor centred on it. These helpers convert between world `(x, z)` and the
 * diagonal frame (distance ALONG the diagonal, signed offset ACROSS the corridor),
 * plus a small deterministic seeded RNG so wave spreads, effect jitter, and the AI
 * can be reproducible where that helps.
 */

import type { Team } from "./types";
import {
  ARENA_SIZE,
  CORRIDOR_HALF_WIDTH,
  MIDLINE_SUM,
  PLAYER_MUSTER,
  ENEMY_MUSTER,
} from "./constants";

/** A point on the ground plane. `+y` is render-only, so gameplay is `(x, z)`. */
export interface Vec2 {
  x: number;
  z: number;
}

const SQRT2 = Math.SQRT2;

/** Squared planar distance (cheap comparisons — no sqrt). */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Planar distance between two ground-plane points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(dist2(a, b));
}

/**
 * Distance ALONG the main diagonal from the player corner: the projection of
 * `(x, z)` onto the unit diagonal `(1,1)/√2`. `0` at the origin, growing toward the
 * enemy corner (max `1200·√2`). This is the tug-of-war axis units advance along.
 */
export function alongDiagonal(p: Vec2): number {
  return (p.x + p.z) / SQRT2;
}

/**
 * Signed offset ACROSS the corridor: the projection onto the perpendicular
 * anti-diagonal `(1,-1)/√2`. Zero on the diagonal; the corridor is the band
 * `|offset| ≤ 240` (specs/playfield.md).
 */
export function offDiagonal(p: Vec2): number {
  return (p.x - p.z) / SQRT2;
}

/** Reconstruct a world point from its diagonal-frame `(along, off)` coordinates. */
export function fromDiagonal(along: number, off: number): Vec2 {
  return { x: (along + off) / SQRT2, z: (along - off) / SQRT2 };
}

/** `true` if a point lies within the ~480-wide combat corridor. */
export function inCorridor(p: Vec2): boolean {
  return Math.abs(offDiagonal(p)) <= CORRIDOR_HALF_WIDTH;
}

/** Clamp a point back into the corridor band (keeps units off the sand edges). */
export function clampToCorridor(p: Vec2): Vec2 {
  const off = Math.max(-CORRIDOR_HALF_WIDTH, Math.min(CORRIDOR_HALF_WIDTH, offDiagonal(p)));
  return fromDiagonal(alongDiagonal(p), off);
}

/**
 * Which half of the field a point is on (specs/playfield.md): the player's half is
 * `x + z < 1200`, the enemy's is `x + z > 1200`; the midline is `x + z = 1200`. The
 * Aegis never crosses its own side's midline (specs/waves.md).
 */
export function halfOf(p: Vec2): Team {
  return p.x + p.z < MIDLINE_SUM ? "player" : "enemy";
}

/** `x + z` — the midline test value; equals {@link MIDLINE_SUM} on the midline. */
export function midlineSum(p: Vec2): number {
  return p.x + p.z;
}

/**
 * The unit advance direction for a team along the diagonal: player units travel
 * toward the enemy corner (increasing `x + z`), enemy units toward the origin.
 */
export function advanceDir(team: Team): Vec2 {
  const s = team === "player" ? 1 : -1;
  return { x: s / SQRT2, z: s / SQRT2 };
}

/** The angle (radians) a unit faces when travelling `dir` — yaw about `+y`. */
export function facingYaw(dir: Vec2): number {
  return Math.atan2(dir.x, dir.z);
}

/**
 * The muster-line entry points for a wave: `count` slots spread evenly across the
 * corridor width at the team's muster line (specs/waves.md — a spread rank, not a
 * single stack), each clamped into the corridor.
 */
export function musterPositions(team: Team, count: number): Vec2[] {
  const line = team === "player" ? PLAYER_MUSTER : ENEMY_MUSTER;
  const along = alongDiagonal(line);
  const out: Vec2[] = [];
  if (count <= 0) return out;
  // Spread across [-halfWidth, +halfWidth], leaving a margin so ranks don't touch
  // the corridor edge. A single unit sits on the diagonal.
  const usable = CORRIDOR_HALF_WIDTH * 1.7;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const off = (t - 0.5) * usable;
    out.push(fromDiagonal(along, off));
  }
  return out;
}

/** `true` if a point lies on the ground plane (0..1200 in each axis). */
export function inArena(p: Vec2): boolean {
  return p.x >= 0 && p.x <= ARENA_SIZE && p.z >= 0 && p.z <= ARENA_SIZE;
}

/** Clamp a scalar to `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * A small, fast, deterministic PRNG (mulberry32). Deterministic streams keep wave
 * spreads, muzzle-flash jitter, and AI decisions reproducible where a test or replay
 * wants it, while a fresh seed varies play. Not cryptographic.
 */
export class Rng {
  private state: number;

  constructor(seed = (Math.random() * 0xffffffff) >>> 0) {
    this.state = seed >>> 0;
  }

  /** Next float in `[0, 1)`. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in `[min, max)`. */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in `[min, max]` inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** A uniformly chosen element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }
}
