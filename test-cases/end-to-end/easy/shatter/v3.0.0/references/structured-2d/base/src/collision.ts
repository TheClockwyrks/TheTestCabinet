// Shatter — collision resolution: every impact in the game, and what it does.
//
// Detection here is SWEPT rather than discrete, as `specs/collision.md`
// requires: each body is tested from the position it held at the start of the
// tick along the velocity it crossed the tick with, so a pair whose paths bring
// them within the sum of their radii at any point of the tick collides on it.
// The figures make that load-bearing rather than pedantic — a bullet of radius
// 3 at MUZZLE_SPEED + SHIP_MAX covers ten units in a tick against a Small's
// combined radius of seventeen — so a per-tick overlap test would let fast
// shots and fast rocks pass clean through.
//
// The ship's LETHAL contact test is gated by `ship.collision` and suspended by
// the respawn grace. The slide along the core is neither: it is a separate,
// non-lethal interaction and runs whichever way the gate stands.

import type { FrameCues } from "./audio";
import {
  BULLET_R,
  CORE_R,
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SCORE_LARGE,
  SCORE_MEDIUM,
  SCORE_SAUCER,
  SCORE_SMALL,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TICK_DT,
  type RockSize,
} from "./constants";
import { sweptTime } from "./geometry";
import { addScore, loseLife } from "./flow";
import type { BulletState, RockState, ShatterState } from "./game";
import { recycleRock, shatterRock } from "./rocks";
import { slideAlongCore } from "./ship";

/** Where a body stood at the start of the tick, and how it crossed it. */
export interface Moving {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Every body's start-of-tick reading, which the sweep is measured from. */
export interface TickPrev {
  ship: Moving;
  saucer: Moving | null;
  /** Keyed by id: the bullets, the rocks, and the saucer's bullets. */
  bodies: Map<number, Moving>;
}

/** What a destroyed rock of each size pays. */
const SCORE_BY_SIZE: Readonly<Record<RockSize, number>> = {
  large: SCORE_LARGE,
  medium: SCORE_MEDIUM,
  small: SCORE_SMALL,
};

/** Whether two swept circles of combined radius `r` meet inside this tick. */
function meets(a: Moving, b: Moving, r: number): number | null {
  return sweptTime(a.x, a.y, a.vx, a.vy, b.x, b.y, b.vx, b.vy, r, TICK_DT);
}

/** The star's core, which never moves. */
const CORE: Moving = { x: STAR_X, y: STAR_Y, vx: 0, vy: 0 };

/** Drop one entry from a roster by identity. */
function drop(roster: BulletState[], entry: BulletState): void {
  const index = roster.indexOf(entry);
  if (index >= 0) roster.splice(index, 1);
}

/** What one of the ship's bullets reached first, if it reached anything. */
type BulletTarget =
  { kind: "core" } | { kind: "saucer" } | { kind: "rock"; rock: RockState };

/**
 * The ship's bullets: a rock splits and scores, the saucer is destroyed and
 * scores, and the core absorbs. Whichever the bullet reaches FIRST in the tick
 * is the one that resolves.
 */
function resolveBullets(
  state: ShatterState,
  prev: TickPrev,
  cues: FrameCues,
): number {
  let destroyed = 0;

  for (const bullet of [...state.bullets]) {
    const from = prev.bodies.get(bullet.id);
    if (from === undefined) continue;

    let best = Infinity;
    let target: BulletTarget | null = null;

    const core = meets(from, CORE, BULLET_R + CORE_R);
    if (core !== null) {
      best = core;
      target = { kind: "core" };
    }

    for (const rock of state.rocks) {
      const at = prev.bodies.get(rock.id);
      if (at === undefined) continue;
      const t = meets(from, at, BULLET_R + ROCK_RADIUS[rock.size]);
      if (t !== null && t < best) {
        best = t;
        target = { kind: "rock", rock };
      }
    }

    if (state.saucer !== null && prev.saucer !== null) {
      const t = meets(from, prev.saucer, BULLET_R + SAUCER_R);
      if (t !== null && t < best) {
        target = { kind: "saucer" };
      }
    }

    if (target === null) continue;
    drop(state.bullets, bullet);

    if (target.kind === "rock") {
      addScore(state, SCORE_BY_SIZE[target.rock.size], cues);
      cues.shatter = true;
      shatterRock(state, target.rock, from.vx, from.vy);
      destroyed += 1;
    } else if (target.kind === "saucer") {
      state.saucer = null;
      addScore(state, SCORE_SAUCER, cues);
    }
  }

  return destroyed;
}

/**
 * The saucer's bullets: the core absorbs one, and one reaching the ship costs a
 * life and is removed. A rock is not one of its targets — the round passes over
 * it and both carry on.
 */
function resolveEnemyBullets(
  state: ShatterState,
  prev: TickPrev,
  cues: FrameCues,
  lethal: boolean,
): boolean {
  let killed = false;

  for (const bullet of [...state.enemyBullets]) {
    const from = prev.bodies.get(bullet.id);
    if (from === undefined) continue;

    const core = meets(from, CORE, SAUCER_BULLET_R + CORE_R);
    const ship =
      lethal && !killed
        ? meets(from, prev.ship, SAUCER_BULLET_R + SHIP_R)
        : null;

    if (ship !== null && (core === null || ship <= core)) {
      drop(state.enemyBullets, bullet);
      loseLife(state, cues);
      killed = true;
      continue;
    }
    if (core !== null) drop(state.enemyBullets, bullet);
  }

  return killed;
}

/** A rock the star swallows, re-placed at an edge at a fresh drift speed. */
function resolveRocksAtTheCore(state: ShatterState, prev: TickPrev): void {
  for (const rock of state.rocks) {
    const from = prev.bodies.get(rock.id);
    if (from === undefined) continue;
    if (meets(from, CORE, ROCK_RADIUS[rock.size] + CORE_R) === null) continue;
    recycleRock(state, rock);
  }
}

/** A rock or the saucer reaching the ship: one life, once per tick. */
function resolveShipContacts(
  state: ShatterState,
  prev: TickPrev,
  cues: FrameCues,
): void {
  for (const rock of state.rocks) {
    const at = prev.bodies.get(rock.id);
    if (at === undefined) continue;
    if (meets(prev.ship, at, SHIP_R + ROCK_RADIUS[rock.size]) === null)
      continue;
    loseLife(state, cues);
    return;
  }

  if (state.saucer !== null && prev.saucer !== null) {
    if (meets(prev.ship, prev.saucer, SHIP_R + SAUCER_R) !== null) {
      loseLife(state, cues);
    }
  }
}

/**
 * Every impact this tick produced, resolved in one pass, and the number of
 * rocks destroyed by it — which is what tells the wave loop whether the wave
 * turned over on this tick.
 */
export function resolveCollisions(
  state: ShatterState,
  prev: TickPrev,
  cues: FrameCues,
): number {
  const destroyed = resolveBullets(state, prev, cues);
  resolveRocksAtTheCore(state, prev);

  const lethal = state.ship.collision && state.ship.invuln <= 0;
  const killed = resolveEnemyBullets(state, prev, cues, lethal);
  if (lethal && !killed) resolveShipContacts(state, prev, cues);

  slideAlongCore(state.ship);
  return destroyed;
}
