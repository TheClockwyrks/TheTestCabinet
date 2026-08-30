// Spectra — the one bullet roster (specs/ship.md, specs/swarm.md).
//
// One roster holds both kinds, told apart by `friendly`, and ids are unique
// across the whole of it (`specs/state.md`). A bullet carries the band it was
// fired with for its whole life: nothing here writes `band` after the fact,
// because `specs/bands.md` fixes it at the shot.
//
// A bullet's motion is `p += v * h` inside a sub-step, like everything else, and
// a bullet that leaves the play field is removed — a player bullet whose centre
// climbs above `FIELD_TOP`, an enemy bullet whose centre falls below
// `FIELD_BOTTOM` (`specs/field.md`).

import {
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  PLAYER_BULLET_SPEED,
  bulletSpeedScale,
} from "./constants";
import type { Band, BulletState, SpectraState } from "./game";

/** Add one bullet with an explicit velocity, appended with a fresh id. */
export function addBulletTo(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
  friendly: boolean,
  vx: number,
  vy: number,
): BulletState {
  const bullet: BulletState = {
    id: state.nextId,
    x,
    y,
    vx,
    vy,
    band,
    friendly,
  };
  state.nextId += 1;
  state.bullets.push(bullet);
  return bullet;
}

/** One of the player's bullets, climbing straight up at its own speed. */
export function addPlayerBulletTo(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
): BulletState {
  return addBulletTo(state, x, y, band, true, 0, -PLAYER_BULLET_SPEED);
}

/** How fast an enemy bullet falls at the current stage. */
export function enemyBulletSpeed(state: SpectraState): number {
  return ENEMY_BULLET_SPEED * bulletSpeedScale(state.stage);
}

/** One enemy bullet, falling straight down at the stage's own speed. */
export function addEnemyBulletTo(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
): BulletState {
  return addBulletTo(state, x, y, band, false, 0, enemyBulletSpeed(state));
}

/**
 * One enemy bullet on a heading `degrees` off straight down, which is what an
 * overloaded Flux's fanned spray is made of (`specs/mode.md`).
 */
export function addFannedEnemyBulletTo(
  state: SpectraState,
  x: number,
  y: number,
  band: Band,
  degrees: number,
): BulletState {
  const radians = (degrees * Math.PI) / 180;
  const speed = enemyBulletSpeed(state);
  return addBulletTo(
    state,
    x,
    y,
    band,
    false,
    Math.sin(radians) * speed,
    Math.cos(radians) * speed,
  );
}

/** Advance every bullet by `h` seconds and drop the ones that left the field. */
export function advanceBullets(state: SpectraState, h: number): void {
  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * h;
    bullet.y += bullet.vy * h;
  }
  state.bullets = state.bullets.filter((bullet) =>
    bullet.friendly ? bullet.y >= FIELD_TOP : bullet.y <= FIELD_BOTTOM,
  );
}

/** Remove the bullet with `id`, of either kind. */
export function removeBullet(state: SpectraState, id: number): void {
  state.bullets = state.bullets.filter((bullet) => bullet.id !== id);
}
