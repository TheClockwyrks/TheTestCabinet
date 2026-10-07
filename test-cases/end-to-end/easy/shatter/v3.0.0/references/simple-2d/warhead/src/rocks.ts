// Shatter — the rocks (`specs/rocks.md`).
//
// Everything that happens TO a rock rather than to the field it drifts in: how
// one is put on the field, how a wave's rocks are placed, what a destroyed rock
// leaves behind, and what the star does with one it swallows.
//
// Three of these are worth reading before changing anything:
//
//   * A rock added through the debug surface enters AT REST at full health for
//     its size, so the pose is the caller's alone
//     (`specs/instrumentation.md`). Only a wave and a recycle give a rock a
//     drift speed, and each draws it from the range its size fixes.
//   * A split appends BOTH fragments in order, each with a fresh id, at the
//     destroyed rock's position. The kick each takes is decided by whatever
//     destroyed the rock and is handed in, because `specs/collision.md` owns the
//     two fans and this file owns only where the fragments come from.
//   * A recycle is the SAME ROCK relocated: it keeps its id, its size and its
//     health, and takes a fresh base drift speed. It scores nothing and leaves
//     the field's rock count unchanged.

import {
  CUES,
  FIELD_H,
  FIELD_W,
  ROCK_CHILD,
  ROCK_HEALTH,
  ROCK_RADIUS,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  SCORE_LARGE,
  SCORE_MEDIUM,
  SCORE_SMALL,
  STAR_X,
  STAR_Y,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
  type RockSize,
} from "./constants";
import type { FieldEdge } from "./game";
import { wrappedDistance } from "./geometry";
import { hashed, range, rangeInt } from "./rng";
import { award } from "./scoring";
import { takeId, type FrameEvents, type MutRock, type Sim } from "./sim";
import {
  ROCK_SPIN_RATE,
  WAVE_PLACEMENT_MARGIN,
  WAVE_PLACEMENT_TRIES,
} from "./tuning";

/** The score a rock of that size pays when it is destroyed. */
export function scoreFor(size: RockSize): number {
  switch (size) {
    case "large":
      return SCORE_LARGE;
    case "medium":
      return SCORE_MEDIUM;
    case "small":
      return SCORE_SMALL;
  }
}

/**
 * How fast a rock's drawn rotation turns, in radians per second.
 *
 * A function of the rock's id, so it is the same every time that rock is drawn.
 * The spin is cosmetic (`specs/rocks.md`) and is not among the draws
 * `specs/simulation.md` lists, so how a build picks it is its own.
 */
export function spinRate(id: number): number {
  return (hashed(id) * 2 - 1) * ROCK_SPIN_RATE;
}

/** Put one rock of `size` on the field at rest, at full health, appended. */
export function addRock(
  sim: Sim,
  size: RockSize,
  x: number,
  y: number,
): MutRock {
  const rock: MutRock = {
    id: takeId(sim),
    x,
    y,
    vx: 0,
    vy: 0,
    size,
    spin: range(0, Math.PI * 2),
    health: ROCK_HEALTH[size],
    flash: 0,
  };
  sim.rocks.push(rock);
  return rock;
}

/**
 * A base drift speed for that size: the one the debug surface posed for the
 * next placement, which this consumes, or a draw from the size's own range.
 */
export function baseSpeed(sim: Sim, size: RockSize): number {
  const posed = sim.nextRockSpeed;
  sim.nextRockSpeed = null;
  return posed ?? range(ROCK_SPEED_MIN[size], ROCK_SPEED_MAX[size]);
}

/** How much faster than the plain range wave `n` drifts. */
export function waveSpeedScale(n: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (n - 1));
}

/**
 * A position for a wave's rock: clear of the ship and clear of the star, both by
 * the shortest wrapped separation.
 *
 * Rejection sampling, because the constraint is a pair of excluded discs on a
 * torus and better than half the field is outside both. The margin is this
 * build's, so a placement that lands exactly on the bound still reads as clear.
 */
function wavePosition(sim: Sim): readonly [number, number] {
  let bestX = 0;
  let bestY = 0;
  let bestSlack = -Infinity;

  for (let i = 0; i < WAVE_PLACEMENT_TRIES; i += 1) {
    const x = range(0, FIELD_W);
    const y = range(0, FIELD_H);
    const fromShip = wrappedDistance(x, y, sim.ship.x, sim.ship.y);
    const fromStar = wrappedDistance(x, y, STAR_X, STAR_Y);
    const slack = Math.min(
      fromShip - WAVE_MIN_SHIP_DIST,
      fromStar - WAVE_MIN_STAR_DIST,
    );
    if (slack >= WAVE_PLACEMENT_MARGIN) return [x, y];
    if (slack > bestSlack) {
      bestSlack = slack;
      bestX = x;
      bestY = y;
    }
  }
  return [bestX, bestY];
}

/** Put wave `n`'s Large rocks on the field, drifting. */
export function spawnWave(sim: Sim, n: number): void {
  const count = WAVE_BASE_ROCKS + n;
  const scale = waveSpeedScale(n);
  // A posed `nextRockSpeed` is the base speed of every rock of this placement,
  // and the placement consumes it (`specs/instrumentation.md`).
  const posed = sim.nextRockSpeed;
  sim.nextRockSpeed = null;

  for (let i = 0; i < count; i += 1) {
    const [x, y] = wavePosition(sim);
    const rock = addRock(sim, "large", x, y);
    const heading = range(0, Math.PI * 2);
    const speed = (posed ?? baseSpeed(sim, "large")) * scale;
    rock.vx = Math.cos(heading) * speed;
    rock.vy = Math.sin(heading) * speed;
  }
}

/**
 * Destroy `rock`, paying its score and leaving the two fragments its size gives.
 *
 * `kickX, kickY` is the kick ONE fragment takes on top of the parent's velocity;
 * the other takes its opposite, which is what puts the two on opposite sides of
 * whatever destroyed them. A Small leaves nothing.
 */
export function destroyRock(
  sim: Sim,
  rock: MutRock,
  kickX: number,
  kickY: number,
  events: FrameEvents,
): void {
  const index = sim.rocks.indexOf(rock);
  if (index < 0) return;
  sim.rocks.splice(index, 1);

  events.rocksDestroyed += 1;
  events.cues.add(CUES.shatter);
  award(sim, scoreFor(rock.size), events);

  const child = ROCK_CHILD[rock.size];
  if (child === null) return;

  for (const sign of [1, -1]) {
    const fragment = addRock(sim, child, rock.x, rock.y);
    fragment.vx = rock.vx + kickX * sign;
    fragment.vy = rock.vy + kickY * sign;
  }
}

/**
 * Take `rock` from the core and put it back at a random edge, heading inward.
 *
 * The same rock: its id, its size and its health all survive. Only its position
 * and its speed are new. The inward spread is kept inside a right angle of the
 * edge's own normal, so the rock is unambiguously travelling away from the edge
 * it came in at.
 */
export function recycleRock(sim: Sim, rock: MutRock): void {
  // The posed edge where the debug surface posed one, consumed here; else a
  // draw, each edge a quarter of the time.
  const edge = sim.nextRecycleEdge ?? FIELD_EDGES[rangeInt(0, 3)];
  sim.nextRecycleEdge = null;
  let inward: number;

  if (edge === "left") {
    rock.x = 1;
    rock.y = range(0, FIELD_H);
    inward = 0;
  } else if (edge === "right") {
    rock.x = FIELD_W - 1;
    rock.y = range(0, FIELD_H);
    inward = Math.PI;
  } else if (edge === "top") {
    rock.x = range(0, FIELD_W);
    rock.y = 1;
    inward = Math.PI / 2;
  } else {
    rock.x = range(0, FIELD_W);
    rock.y = FIELD_H - 1;
    inward = -Math.PI / 2;
  }

  const heading = inward + range(-Math.PI / 3, Math.PI / 3);
  const speed = baseSpeed(sim, rock.size);
  rock.vx = Math.cos(heading) * speed;
  rock.vy = Math.sin(heading) * speed;
}

/** The collision radius of a rock of that size. */
export function radiusOf(size: RockSize): number {
  return ROCK_RADIUS[size];
}

/** The four edges, in the order a drawn index names them. */
const FIELD_EDGES: readonly FieldEdge[] = ["left", "right", "top", "bottom"];
