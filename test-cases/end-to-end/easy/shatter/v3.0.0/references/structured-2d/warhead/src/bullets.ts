// Shatter — the rounds in flight, the ship's and the saucer's alike.
//
// Both are ballistic: the well pulls them (`specs/gravity.md`), they wrap at the
// edges carrying their velocity, and each is removed when its lifetime runs out.
// What they do when they land is `src/collision.ts`.

import { TICK_DT } from "./constants";
import type { BulletState, ShatterState } from "./game";
import { wrapX, wrapY } from "./geometry";
import { applyGravity } from "./gravity";
import { recordMove, type MoveTable } from "./motion";

/** Advance one roster of rounds: the lifetime, the pull, the move, the wrap. */
function advanceRoster(roster: BulletState[], moves: MoveTable): void {
  for (let index = roster.length - 1; index >= 0; index -= 1) {
    const bullet = roster[index];
    bullet.life -= TICK_DT;
    if (bullet.life <= 0) {
      roster.splice(index, 1);
      continue;
    }

    applyGravity(bullet, TICK_DT);

    const mx = bullet.vx * TICK_DT;
    const my = bullet.vy * TICK_DT;
    bullet.x = wrapX(bullet.x + mx);
    bullet.y = wrapY(bullet.y + my);
    recordMove(moves, bullet, mx, my);
  }
}

/** Advance every round in flight, the ship's and the saucer's. */
export function integrateBullets(state: ShatterState, moves: MoveTable): void {
  advanceRoster(state.bullets, moves);
  advanceRoster(state.enemyBullets, moves);
}
