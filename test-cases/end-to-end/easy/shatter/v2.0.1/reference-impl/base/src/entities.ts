// Shatter — entity construction and the ship.
//
// The ship is a small class (it carries facing + velocity and integrates its
// own inertial flight); rocks, bullets, and the saucer are plain data (see
// types.ts) built by the factory functions here and simulated in game.ts.

import {
  FACE_UP,
  FIELD_H,
  FIELD_W,
  ROCK,
  SAFE_X,
  SAFE_Y,
  TAU,
  type RockSize,
} from "./constants";
import { random } from "./rng";
import type { Rock, Saucer, Vec } from "./types";

// ---- Random helpers ----------------------------------------------------
//
// All simulation randomness runs through the seedable generator in rng.ts, so a
// scenario replays identically after reset({ seed }) (see specs/instrumentation.md).

export function rand(min: number, max: number): number {
  return min + random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

// ---- The ship ----------------------------------------------------------

export class Ship {
  x = SAFE_X;
  y = SAFE_Y;
  prevX = SAFE_X;
  prevY = SAFE_Y;
  vx = 0;
  vy = 0;
  angle = FACE_UP; // facing, radians, clockwise from +x (up = -90deg)

  // Reset to the safe point, at rest, facing up — at game start and each
  // respawn (specs/playfield.md).
  reset(): void {
    this.x = SAFE_X;
    this.y = SAFE_Y;
    this.prevX = SAFE_X;
    this.prevY = SAFE_Y;
    this.vx = 0;
    this.vy = 0;
    this.angle = FACE_UP;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  // The world position of the ship's nose, where bullets are born.
  nose(): Vec {
    return {
      x: this.x + Math.cos(this.angle) * 20,
      y: this.y + Math.sin(this.angle) * 20,
    };
  }
}

// ---- Rocks -------------------------------------------------------------

// An irregular angular outline: per-vertex radii jittered around the collision
// radius, so a rock reads as tumbling debris while colliding as a clean circle.
function makeOutline(radius: number): number[] {
  const n = randInt(9, 12);
  const verts: number[] = [];
  for (let i = 0; i < n; i++) {
    verts.push(radius * rand(0.78, 1.12));
  }
  return verts;
}

export function makeRock(
  size: RockSize,
  x: number,
  y: number,
  vx: number,
  vy: number,
): Rock {
  const spec = ROCK[size];
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    vx,
    vy,
    size,
    radius: spec.radius,
    angle: rand(0, TAU),
    spin: rand(-1, 1),
    verts: makeOutline(spec.radius),
  };
}

// A rock drifting from (x, y) at a random heading at its size's base drift
// speed, scaled by the current wave's speed multiplier.
export function driftRock(
  size: RockSize,
  x: number,
  y: number,
  speedMult: number,
): Rock {
  const spec = ROCK[size];
  const speed = rand(spec.speedMin, spec.speedMax) * speedMult;
  const heading = rand(0, TAU);
  return makeRock(
    size,
    x,
    y,
    Math.cos(heading) * speed,
    Math.sin(heading) * speed,
  );
}

// A replacement rock re-entering from just outside a random edge, moving
// inward at its size's base drift speed — the star's recycle (no wave scaling;
// recycling is not a wave spawn). See specs/playfield.md (Star recycling).
export function recycleRock(size: RockSize): Rock {
  const spec = ROCK[size];
  const speed = rand(spec.speedMin, spec.speedMax);
  const margin = spec.radius + 4;
  const edge = randInt(0, 3); // 0 left, 1 right, 2 top, 3 bottom
  let x: number;
  let y: number;
  let vx: number;
  let vy: number;
  // Aim generally inward, with a spread, from the chosen edge.
  if (edge === 0) {
    x = -margin;
    y = rand(0, FIELD_H);
    const a = rand(-Math.PI / 3, Math.PI / 3);
    vx = Math.cos(a) * speed;
    vy = Math.sin(a) * speed;
  } else if (edge === 1) {
    x = FIELD_W + margin;
    y = rand(0, FIELD_H);
    const a = rand(-Math.PI / 3, Math.PI / 3);
    vx = -Math.cos(a) * speed;
    vy = Math.sin(a) * speed;
  } else if (edge === 2) {
    x = rand(0, FIELD_W);
    y = -margin;
    const a = rand(-Math.PI / 3, Math.PI / 3);
    vx = Math.sin(a) * speed;
    vy = Math.cos(a) * speed;
  } else {
    x = rand(0, FIELD_W);
    y = FIELD_H + margin;
    const a = rand(-Math.PI / 3, Math.PI / 3);
    vx = Math.sin(a) * speed;
    vy = -Math.cos(a) * speed;
  }
  return makeRock(size, x, y, vx, vy);
}

// ---- The saucer --------------------------------------------------------

// A saucer entering from the left or right edge at a random height, crossing
// horizontally. See specs/flow.md (The saucer).
export function makeSaucer(speed: number, weaveSpeed: number): Saucer {
  const fromLeft = random() < 0.5;
  const x = fromLeft ? -30 : FIELD_W + 30;
  const vx = fromLeft ? speed : -speed;
  const y = rand(80, FIELD_H - 80);
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    vx,
    vy: rand(-1, 1) * weaveSpeed,
    fireTimer: 1.0,
    weaveTimer: 1.0,
    age: 0,
    travel: 0,
  };
}
