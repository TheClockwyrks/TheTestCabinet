// Spectra — the bullets, the player's and the drones' (`specs/ship.md`,
// `specs/swarm.md`).
//
// One roster holds both kinds, told apart by `friendly`, and every id in it is
// distinct across the whole roster. A bullet carries the band it was fired with
// for its whole life; nothing changes it after the fact.
//
// A bullet is pure motion here. What a contact does to it belongs to
// `src/contacts.ts`, in the order `specs/simulation.md` fixes.

import {
  ENEMY_BULLET_SPEED,
  FIELD_BOTTOM,
  FIELD_TOP,
  PLAYER_BULLET_SPEED,
  bulletSpeedScale,
} from "./constants";
import { takeId, type MutBullet, type Sim } from "./sim";
import type { Band } from "./game";

/** How far below a firing drone's own edge its shot appears. */
const ENEMY_MUZZLE_GAP = 8;

/** How far to either side of a Prism its paired shots leave. */
export const PRISM_MUZZLE_SPREAD = 10;

/** Add one of the player's bullets, climbing at its own speed. */
export function addPlayerBullet(
  sim: Sim,
  x: number,
  y: number,
  band: Band,
): MutBullet {
  const bullet: MutBullet = {
    id: takeId(sim),
    x,
    y,
    vx: 0,
    vy: -PLAYER_BULLET_SPEED,
    band,
    friendly: true,
  };
  sim.bullets.push(bullet);
  return bullet;
}

/** Add one enemy bullet, falling at the stage's own speed. */
export function addEnemyBullet(
  sim: Sim,
  x: number,
  y: number,
  band: Band,
): MutBullet {
  const bullet: MutBullet = {
    id: takeId(sim),
    x,
    y,
    vx: 0,
    vy: ENEMY_BULLET_SPEED * bulletSpeedScale(sim.stage),
    band,
    friendly: false,
  };
  sim.bullets.push(bullet);
  return bullet;
}

/** Add one enemy bullet on a heading, `0` degrees being straight down. */
export function addEnemyBulletOnHeading(
  sim: Sim,
  x: number,
  y: number,
  band: Band,
  degrees: number,
): MutBullet {
  const speed = ENEMY_BULLET_SPEED * bulletSpeedScale(sim.stage);
  const radians = (degrees * Math.PI) / 180;
  const bullet: MutBullet = {
    id: takeId(sim),
    x,
    y,
    vx: speed * Math.sin(radians),
    vy: speed * Math.cos(radians),
    band,
    friendly: false,
  };
  sim.bullets.push(bullet);
  return bullet;
}

/** Where a drone's shot leaves it, given the drone's centre and half-extent. */
export function muzzleY(y: number, half: number): number {
  return y + half + ENEMY_MUZZLE_GAP;
}

/** Advance every bullet by `h`, and drop the ones that have left the field. */
export function advanceBullets(sim: Sim, h: number): void {
  for (const bullet of sim.bullets) {
    bullet.x += bullet.vx * h;
    bullet.y += bullet.vy * h;
  }
  sim.bullets = sim.bullets.filter((bullet) =>
    bullet.friendly ? bullet.y >= FIELD_TOP : bullet.y <= FIELD_BOTTOM,
  );
}
