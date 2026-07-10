// Shatter — shared types.

import type { RockSize } from "./constants";

// The game's state machine (see specs/flow.md — Game states).
export type AppState =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "gameover";

// A plain 2D vector.
export interface Vec {
  x: number;
  y: number;
}

// A ship-fired bullet (also reused for the ship). Gravity acts on it.
export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining before it expires
}

// A drifting rock. `verts` are the per-vertex radii of its irregular outline,
// rotated by `angle` at draw time; the collision shape is the circle `radius`.
export interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  radius: number;
  angle: number; // current cosmetic spin
  spin: number; // cosmetic angular velocity (rad/s)
  verts: number[]; // per-vertex outline radii
}

// The enemy saucer. It is a powered craft: gravity never pulls it.
export interface Saucer {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fireTimer: number; // seconds until the next shot
  weaveTimer: number; // seconds until the weave direction rerolls
  age: number; // seconds since it entered
  travel: number; // horizontal distance covered
}

// A saucer-fired bullet. Gravity acts on it; it harms only the ship.
export interface EnemyBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
