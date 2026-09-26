// Shatter — every impact on the field, and what each one does.
//
// `specs/collision.md` states the table this file implements. Two properties of
// it shape everything here:
//
//   * EVERY BODY IS A CIRCLE, and two touch when the SHORTEST WRAPPED separation
//     between their centres is at most the sum of their radii — so a pair
//     touching across a seam collides like any other.
//   * COLLISION IS SWEPT. Two bodies whose paths over a tick bring them within
//     that sum collide on that tick, however fast either was travelling. A bullet
//     is three units across and crosses ten in a tick, so a test that only looked
//     at where the tick ended would let one through a Small without touching it.
//     Each test below reconstructs where the pair stood when the tick BEGAN — the
//     end position less the tick's travel — and asks whether the two closed
//     inside it.
//
// Resolution runs after the whole field has moved (`specs/simulation.md`, step
// 6), so what is tested is the motion that just happened.

import {
  BULLET_R,
  CORE_R,
  SAUCER_BULLET_R,
  SAUCER_R,
  SCORE_SAUCER,
  SHIP_R,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import { recycleRock } from "./entities";
import { shortestDelta, sweptOverlap } from "./geometry";
import type { Moving } from "./motion";
import { hitRockWithBullet } from "./rocks";
import { departSaucer } from "./saucer";
import type { Bullet, EnemyBullet, ShatterState } from "./types";
import { addScore, killShip } from "./world";

/** The star's core, as a body: fixed at the field's centre and never moving. */
const CORE: Moving = { x: STAR_X, y: STAR_Y, vx: 0, vy: 0 };

/**
 * Whether two circles closed to within `radius` of one another at some point of
 * the tick that just ran.
 *
 * The separation at the end of the tick and the relative velocity are both known,
 * so the separation at the START of it is the end less one tick of relative
 * travel. That is the pair's real path over the tick, which is what makes this a
 * swept test rather than a sample at the tick's edge.
 */
function closedThisTick(a: Moving, b: Moving, radius: number): boolean {
  const end = shortestDelta(b.x, b.y, a.x, a.y);
  const relVx = a.vx - b.vx;
  const relVy = a.vy - b.vy;
  return sweptOverlap(
    end.x - relVx * TICK_DT,
    end.y - relVy * TICK_DT,
    relVx,
    relVy,
    radius,
    TICK_DT,
  );
}

/** Whether a body of `radius` reached the star's solid core over the tick. */
function reachedCore(body: Moving, radius: number): boolean {
  return closedThisTick(body, CORE, CORE_R + radius);
}

/** The index of the first rock a moving circle of `radius` reached, or `-1`. */
function firstRockReached(
  state: ShatterState,
  body: Moving,
  radius: number,
): number {
  for (let i = 0; i < state.rocks.length; i += 1) {
    const rock = state.rocks[i];
    if (closedThisTick(body, rock, radius + rock.radius)) return i;
  }
  return -1;
}

/** The saucer is destroyed: it pays, and it leaves the field. */
function destroySaucer(state: ShatterState): void {
  addScore(state, SCORE_SAUCER);
  departSaucer(state);
}

/**
 * The ship's bullets: absorbed by the core, or spent on the saucer, or spent
 * destroying the first rock they reach.
 */
function resolveBullets(state: ShatterState): void {
  const surviving: Bullet[] = [];
  for (const bullet of state.bullets) {
    if (reachedCore(bullet, BULLET_R)) continue;
    if (
      state.saucer !== null &&
      closedThisTick(bullet, state.saucer, BULLET_R + SAUCER_R)
    ) {
      destroySaucer(state);
      continue;
    }
    const index = firstRockReached(state, bullet, BULLET_R);
    if (index >= 0) {
      hitRockWithBullet(state, index, bullet.vx, bullet.vy);
      continue;
    }
    surviving.push(bullet);
  }
  state.bullets = surviving;
}

/** Rocks the star swallowed: relocated to an edge, scoring nothing and losing none. */
function resolveRocks(state: ShatterState): void {
  for (const rock of state.rocks) {
    if (reachedCore(rock, rock.radius)) recycleRock(state, rock);
  }
}

/** Saucer bullets: absorbed by the core, and nothing else. They pass over rocks. */
function resolveEnemyBullets(state: ShatterState): void {
  const surviving: EnemyBullet[] = [];
  for (const bullet of state.enemyBullets) {
    if (!reachedCore(bullet, SAUCER_BULLET_R)) surviving.push(bullet);
  }
  state.enemyBullets = surviving;
}

/**
 * The ship's three lethal contacts: a rock, the saucer, and a saucer bullet.
 *
 * Two things suspend them, and neither is the core. The respawn grace
 * (`specs/progression.md`) is the game's own, and the contact gate
 * (`specs/instrumentation.md`) is the debug surface's; with either running the
 * ship passes through unharmed. The core is not here at all: it is solid but
 * never lethal, and `src/ship.ts` slides the ship off it.
 *
 * A saucer bullet that lands is removed with the ship it destroyed, which the
 * specification's own row for the pair fixes.
 */
function resolveShip(state: ShatterState): void {
  const ship = state.ship;
  if (!ship.collision || ship.invuln > 0) return;

  for (const rock of state.rocks) {
    if (closedThisTick(ship, rock, SHIP_R + rock.radius)) {
      killShip(state);
      return;
    }
  }
  if (
    state.saucer !== null &&
    closedThisTick(ship, state.saucer, SHIP_R + SAUCER_R)
  ) {
    killShip(state);
    return;
  }
  for (let i = 0; i < state.enemyBullets.length; i += 1) {
    if (closedThisTick(ship, state.enemyBullets[i], SHIP_R + SAUCER_BULLET_R)) {
      state.enemyBullets.splice(i, 1);
      killShip(state);
      return;
    }
  }
}

/** Step 6 of the tick: resolve every impact the motion just made. */
export function resolveCollisions(state: ShatterState): void {
  resolveBullets(state);
  resolveRocks(state);
  resolveEnemyBullets(state);
  resolveShip(state);
}
