// Shatter — the rocks: what they are, what a destroyed one leaves, and what the
// star does with one it swallows.
//
// Two rules here decide points a validator reads directly. A destroyed rock's
// fragments carry the parent's own velocity plus a kick taken PERPENDICULAR TO
// THE BULLET'S TRAVEL rather than to the rock's course, so the fan lies across
// the shot whatever the rock was doing (`specs/collision.md`). And a rock the
// star swallows is the SAME rock relocated: it keeps its id and its size, and
// it re-enters from an edge at a fresh base drift speed, so recycling never
// empties the field and never accelerates a rock that keeps falling in
// (`specs/rocks.md`).

import {
  ROCK_CHILD,
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SPLIT_KICK,
  TICK_DT,
  FIELD_H,
  FIELD_W,
  type RockSize,
} from "./constants";
import { takeId } from "./entities";
import type { RockState, ShatterState } from "./game";
import { randomInt, randomRange } from "./rng";

/** How far inside the edge a re-entering rock is placed. */
const REENTRY_INSET = 2;

/** How far off straight inward a re-entering rock may be aimed, in radians. */
const REENTRY_SPREAD = (50 * Math.PI) / 180;

/** The collision radius a rock's size fixes. */
export function rockRadius(size: RockSize): number {
  return ROCK_RADIUS[size];
}

/**
 * The drawn spin rate a rock turns at, in radians per second.
 *
 * It is a pure function of the rock's id rather than a stored field, because
 * the spin is cosmetic: it changes neither the rock's velocity nor its
 * collision, so nothing but the drawing may depend on it.
 */
export function spinRate(id: number): number {
  const mixed = Math.imul(id, 0x9e3779b1) >>> 0;
  return ((mixed % 2000) / 1000 - 1) * 0.5;
}

/** Advance every rock's drawn rotation by one tick. It moves nothing. */
export function advanceSpins(state: ShatterState): void {
  for (const rock of state.rocks) {
    rock.spin += spinRate(rock.id) * TICK_DT;
  }
}

/** A fresh base drift speed for a rock of `size`, drawn from its own range. */
export function baseDriftSpeed(state: ShatterState, size: RockSize): number {
  return randomRange(state, ROCK_SPEED_MIN[size], ROCK_SPEED_MAX[size]);
}

/**
 * Take `rock` off the field and leave the two fragments its size produces,
 * appended in order, each with a fresh id.
 *
 * `(bvx, bvy)` is the travel of the bullet that landed. Each fragment takes the
 * destroyed rock's velocity plus `SPLIT_KICK` perpendicular to that travel, the
 * two kicked to opposite sides, so the average of the pair is the parent's
 * velocity and their difference is twice the kick.
 */
export function shatterRock(
  state: ShatterState,
  rock: RockState,
  bvx: number,
  bvy: number,
): void {
  const index = state.rocks.indexOf(rock);
  if (index >= 0) state.rocks.splice(index, 1);

  const child = ROCK_CHILD[rock.size];
  if (child === null) return;

  const travel = Math.hypot(bvx, bvy);
  // A round with no travel at all cannot state a perpendicular, so the fan
  // opens across the field's x axis instead of collapsing onto one point.
  const px = travel === 0 ? 0 : -bvy / travel;
  const py = travel === 0 ? 1 : bvx / travel;

  for (const side of [1, -1]) {
    state.rocks.push({
      id: takeId(state),
      x: rock.x,
      y: rock.y,
      vx: rock.vx + side * SPLIT_KICK * px,
      vy: rock.vy + side * SPLIT_KICK * py,
      size: child,
      spin: rock.spin,
    });
  }
}

/**
 * The star swallowing a rock: the same rock, re-placed at a random point on one
 * of the four edges, heading inward, at a fresh base drift speed for its size.
 *
 * Its id and its size are untouched, so the field's rock count is unchanged and
 * nothing scores.
 */
export function recycleRock(state: ShatterState, rock: RockState): void {
  const edge = randomInt(state, 0, 3);
  const speed = baseDriftSpeed(state, rock.size);
  const spread = randomRange(state, -REENTRY_SPREAD, REENTRY_SPREAD);

  let inward: number;
  switch (edge) {
    case 0:
      rock.x = REENTRY_INSET;
      rock.y = randomRange(state, 0, FIELD_H);
      inward = 0;
      break;
    case 1:
      rock.x = FIELD_W - REENTRY_INSET;
      rock.y = randomRange(state, 0, FIELD_H);
      inward = Math.PI;
      break;
    case 2:
      rock.x = randomRange(state, 0, FIELD_W);
      rock.y = REENTRY_INSET;
      inward = Math.PI / 2;
      break;
    default:
      rock.x = randomRange(state, 0, FIELD_W);
      rock.y = FIELD_H - REENTRY_INSET;
      inward = -Math.PI / 2;
      break;
  }

  const heading = inward + spread;
  rock.vx = Math.cos(heading) * speed;
  rock.vy = Math.sin(heading) * speed;
}
