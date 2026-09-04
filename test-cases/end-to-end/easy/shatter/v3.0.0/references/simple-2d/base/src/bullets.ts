// Shatter — what the ship shoots (`specs/weapons.md`).
//
// A round is a ballistic body: it leaves the nose carrying the ship's own
// velocity plus the muzzle speed along the facing, and from there the well, the
// wrap and the collision rules own it exactly as they own a rock.
//
// Two gates decide how fast the gun goes, and they are deliberately separate.
// `FIRE_INTERVAL_TICKS` is the gun's own cadence and is armed only when a shot
// actually leaves; `MAX_BULLETS` is the field's, and a shot the cap refuses
// arms nothing, so the moment a round expires the next one goes.

import {
  BULLET_LIFE,
  CUES,
  FIRE_INTERVAL_TICKS,
  MAX_BULLETS,
  MUZZLE_SPEED,
  SAUCER_BULLET_LIFE,
} from "./constants";
import { wrapX, wrapY } from "./field";
import { shipNose } from "./ship";
import { takeId, type MutBullet, type Sim, type TickEvents } from "./sim";
import type { FrameInput } from "./input";

/** Put one of the ship's rounds in flight, appended with a fresh id. */
export function addBullet(
  sim: Sim,
  x: number,
  y: number,
  vx: number,
  vy: number,
): MutBullet {
  const bullet: MutBullet = {
    id: takeId(sim),
    x: wrapX(x),
    y: wrapY(y),
    vx,
    vy,
    life: BULLET_LIFE,
  };
  sim.bullets.push(bullet);
  return bullet;
}

/** Put one saucer round in flight, appended with a fresh id. */
export function addEnemyBullet(
  sim: Sim,
  x: number,
  y: number,
  vx: number,
  vy: number,
): MutBullet {
  const bullet: MutBullet = {
    id: takeId(sim),
    x: wrapX(x),
    y: wrapY(y),
    vx,
    vy,
    life: SAUCER_BULLET_LIFE,
  };
  sim.enemyBullets.push(bullet);
  return bullet;
}

/**
 * The gun, once per tick.
 *
 * Firing is read as a hold: one press takes one shot because the gate is open,
 * and a held key takes one every `FIRE_INTERVAL_TICKS` for as long as the cap
 * allows.
 */
export function fireGun(sim: Sim, input: FrameInput, ev: TickEvents): void {
  if (!input.fire) return;
  if (sim.ship.fireCooldown > 0) return;
  if (sim.bullets.length >= MAX_BULLETS) return;

  const ship = sim.ship;
  const [nx, ny] = shipNose(ship);
  addBullet(
    sim,
    nx,
    ny,
    ship.vx + Math.cos(ship.angle) * MUZZLE_SPEED,
    ship.vy + Math.sin(ship.angle) * MUZZLE_SPEED,
  );
  ship.fireCooldown = FIRE_INTERVAL_TICKS;
  ev.cues.add(CUES.fire);
}
