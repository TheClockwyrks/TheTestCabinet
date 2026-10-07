// Shatter — the ballistic shots: the ship's bullets and the saucer's.
//
// Both are the same body under two names: a small circle the well pulls
// (`specs/gravity.md`), that wraps at the seams, that carries a life it runs down
// (`specs/weapons.md`, `specs/saucer.md`), and that is removed when it lands or
// when the core absorbs it (`specs/collision.md`, resolved in
// `src/collision.ts`). What differs is what each one does when it reaches
// something, which is not this file's business.
//
// The ship's bullets additionally record where they have been, because
// `specs/weapons.md` requires a fading tail along the last `TRAIL_TICKS` ticks of
// travel. The record is written here, once per tick, and read only by the
// renderer.

import { TICK_DT, TRAIL_TICKS } from "./constants";
import { pull, travel } from "./motion";
import type { Bullet, EnemyBullet, ShatterState } from "./types";

/**
 * Append where a bullet now stands to its trail, dropping the oldest sample once
 * the record spans `TRAIL_TICKS` ticks of travel.
 *
 * The window is a slice of TIME rather than of distance, which is what makes the
 * drawn tail's length proportional to the bullet's speed.
 */
function recordTrail(bullet: Bullet): void {
  bullet.trail.push({ x: bullet.x, y: bullet.y });
  while (bullet.trail.length > TRAIL_TICKS + 1) bullet.trail.shift();
}

/** One tick for every one of the ship's bullets: pulled, moved, wrapped, aged. */
export function integrateBullets(state: ShatterState): void {
  const alive: Bullet[] = [];
  for (const bullet of state.bullets) {
    pull(bullet, TICK_DT);
    travel(bullet, TICK_DT);
    recordTrail(bullet);
    bullet.life -= TICK_DT;
    if (bullet.life > 0) alive.push(bullet);
  }
  state.bullets = alive;
}

/** One tick for every saucer bullet, on exactly the same terms. */
export function integrateEnemyBullets(state: ShatterState): void {
  const alive: EnemyBullet[] = [];
  for (const bullet of state.enemyBullets) {
    pull(bullet, TICK_DT);
    travel(bullet, TICK_DT);
    bullet.life -= TICK_DT;
    if (bullet.life > 0) alive.push(bullet);
  }
  state.enemyBullets = alive;
}
