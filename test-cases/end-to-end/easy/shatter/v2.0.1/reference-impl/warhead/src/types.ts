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

// A ship-fired bullet. Gravity acts on it.
export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining before it expires
  // Recent positions (oldest -> newest) for the motion trail, one per sim step;
  // capped to a fixed slice of travel time so its length scales with speed.
  trail: Vec[];
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
  hp: number; // remaining health (Warhead armor); a split rock enters full, a star-recycled rock keeps its damage
  hitFlash: number; // seconds of bright hit-flash remaining after a non-fatal hit
}

// The Warhead secondary weapon: a single self-propelled homing torpedo. It is a
// powered body, so the star never pulls it; it flies true and homes onto a
// target within a narrow forward cone. See specs/gameplay.md.
export interface Torpedo {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number; // current heading, radians (velocity always follows this)
  life: number; // seconds remaining before it expires
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
