// Shatter — every impact and what it does (`specs/collision.md`).
//
// Two properties make this file what it is.
//
// SWEPT, NOT SAMPLED. Every pair is tested over the whole of the tick's motion
// rather than at its two ends, so no body passes through another however fast
// either was travelling. A tick has already moved both bodies by the time this
// runs, and each moved by exactly its own velocity times `TICK_DT`, so the
// start of the tick is recoverable without storing anything: it is the body's
// position minus that displacement.
//
// THE SHORTEST WRAPPED SEPARATION. Every test measures across the seams, so two
// bodies touching around the edge of the field collide exactly as two in the
// middle do.
//
// The ship's two interactions with the core are deliberately different in kind.
// A lethal contact is gated by `ship.collision` and by the respawn grace; the
// SLIDE along the core is neither, because it costs nothing and is what the
// core is for. The slide is also the one test written against strict
// penetration rather than touching, so a ship resting exactly on the surface
// and thrusting away is free to leave rather than being pinned there.

import {
  BULLET_R,
  CORE_R,
  CUES,
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
import { separation, wrapX, wrapY } from "./field";
import { departSaucer } from "./saucer";
import { loseShip } from "./flow";
import { recycleRock, rockRadius, splitKickAcross, splitRock } from "./rocks";
import { addScore } from "./scoring";
import type { MutBullet, MutRock, Sim, TickEvents } from "./sim";

/** What one size of rock is worth when it is destroyed. */
const SCORE_BY_SIZE: Readonly<Record<RockSize, number>> = {
  large: SCORE_LARGE,
  medium: SCORE_MEDIUM,
  small: SCORE_SMALL,
};

/** A body as the sweep sees it: where it ended, and how far it moved to get there. */
interface Moving {
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly r: number;
}

/** The body a velocity moved over this tick, ready for the sweep. */
function moving(
  body: { x: number; y: number; vx: number; vy: number },
  radius: number,
  moved = true,
): Moving {
  return {
    x: body.x,
    y: body.y,
    dx: moved ? body.vx * TICK_DT : 0,
    dy: moved ? body.vy * TICK_DT : 0,
    r: radius,
  };
}

/** A body that did not move at all this tick, such as the star's core. */
function fixed(x: number, y: number, radius: number): Moving {
  return { x, y, dx: 0, dy: 0, r: radius };
}

/** The relative sweep of `a` against `b`: where it started, and the closing. */
function relative(
  a: Moving,
  b: Moving,
): readonly [number, number, number, number, number] {
  const [rx, ry] = separation(a.x - a.dx, a.y - a.dy, b.x - b.dx, b.y - b.dy);
  return [rx, ry, b.dx - a.dx, b.dy - a.dy, a.r + b.r];
}

/**
 * When in this tick the two first TOUCH, as a fraction of it, or `null`.
 *
 * Touching counts, per `specs/collision.md`: two bodies touch when the shortest
 * wrapped separation between their centres is at most the sum of their radii.
 */
export function sweepTouch(a: Moving, b: Moving): number | null {
  const [rx, ry, wx, wy, radii] = relative(a, b);
  const c = rx * rx + ry * ry - radii * radii;
  if (c <= 0) return 0;

  const quad = wx * wx + wy * wy;
  if (quad === 0) return null;
  const lin = 2 * (rx * wx + ry * wy);
  const disc = lin * lin - 4 * quad * c;
  if (disc < 0) return null;

  const t = (-lin - Math.sqrt(disc)) / (2 * quad);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * When in this tick `a` first moves strictly INSIDE `b`, or `null`.
 *
 * The difference from `sweepTouch` matters in exactly one place: a ship resting
 * on the core's surface is touching it every tick, and resolving that again
 * every tick would pin it there. Penetration is what the slide answers to.
 */
export function sweepInside(a: Moving, b: Moving): number | null {
  const [rx, ry, wx, wy, radii] = relative(a, b);
  const c = rx * rx + ry * ry - radii * radii;
  if (c < 0) return 0;

  const quad = wx * wx + wy * wy;
  if (quad === 0) return null;
  const lin = 2 * (rx * wx + ry * wy);
  const disc = lin * lin - 4 * quad * c;
  if (disc <= 0) return null;

  const root = Math.sqrt(disc);
  const enter = (-lin - root) / (2 * quad);
  const leave = (-lin + root) / (2 * quad);
  if (leave <= 0 || enter >= 1) return null;
  return Math.max(0, enter);
}

/** Destroy a rock: score it, split it, and record that the tick took one down. */
function destroyRock(
  sim: Sim,
  rock: MutRock,
  kickX: number,
  kickY: number,
  ev: TickEvents,
): void {
  const index = sim.rocks.indexOf(rock);
  if (index >= 0) sim.rocks.splice(index, 1);
  addScore(sim, SCORE_BY_SIZE[rock.size], ev);
  ev.cues.add(CUES.shatter);
  ev.rocksDestroyed += 1;
  splitRock(sim, rock, kickX, kickY);
}

/** The ship's rounds, against the rocks, the saucer, and the core. */
function resolveShipBullets(sim: Sim, ev: TickEvents): void {
  // The rocks as this tick moved them: a fragment appended part-way through is
  // not a target for the rounds still being resolved.
  const targets = sim.rocks.slice();
  const survivors: MutBullet[] = [];

  for (const bullet of sim.bullets) {
    const shot = moving(bullet, BULLET_R);

    let bestAt = Number.POSITIVE_INFINITY;
    let hitRock: MutRock | null = null;
    let hitSaucer = false;
    let hitCore = false;

    for (const rock of targets) {
      if (!sim.rocks.includes(rock)) continue;
      const at = sweepTouch(shot, moving(rock, rockRadius(rock.size)));
      if (at !== null && at < bestAt) {
        bestAt = at;
        hitRock = rock;
        hitSaucer = false;
        hitCore = false;
      }
    }

    const saucer = sim.saucer;
    if (saucer !== null) {
      const at = sweepTouch(shot, moving(saucer, SAUCER_R, saucer.travel));
      if (at !== null && at < bestAt) {
        bestAt = at;
        hitRock = null;
        hitSaucer = true;
        hitCore = false;
      }
    }

    const at = sweepTouch(shot, fixed(STAR_X, STAR_Y, CORE_R));
    if (at !== null && at < bestAt) {
      bestAt = at;
      hitRock = null;
      hitSaucer = false;
      hitCore = true;
    }

    if (hitRock !== null) {
      const [kx, ky] = splitKickAcross(bullet.vx, bullet.vy);
      destroyRock(sim, hitRock, kx, ky, ev);
      continue;
    }
    if (hitSaucer) {
      addScore(sim, SCORE_SAUCER, ev);
      ev.cues.add(CUES.shatter);
      departSaucer(sim);
      continue;
    }
    if (hitCore) continue;

    survivors.push(bullet);
  }

  sim.bullets = survivors;
}

/** The saucer's rounds, against the core and the ship. A rock is passed over. */
function resolveEnemyBullets(sim: Sim, ev: TickEvents): void {
  const survivors: MutBullet[] = [];
  let lost = false;

  for (const bullet of sim.enemyBullets) {
    if (lost) {
      survivors.push(bullet);
      continue;
    }
    const shot = moving(bullet, SAUCER_BULLET_R);

    const atCore = sweepTouch(shot, fixed(STAR_X, STAR_Y, CORE_R));
    const atShip = shipIsVulnerable(sim)
      ? sweepTouch(shot, moving(sim.ship, SHIP_R))
      : null;

    if (atShip !== null && (atCore === null || atShip <= atCore)) {
      loseShip(sim, ev);
      lost = true;
      continue;
    }
    if (atCore !== null) continue;

    survivors.push(bullet);
  }

  sim.enemyBullets = survivors;
}

/** Whether a lethal contact costs the ship anything this tick. */
function shipIsVulnerable(sim: Sim): boolean {
  return sim.ship.collision && sim.ship.invuln <= 0;
}

/** A rock the core swallows is recycled rather than removed. */
function resolveRocksAtTheCore(sim: Sim): void {
  const core = fixed(STAR_X, STAR_Y, CORE_R);
  for (const rock of sim.rocks) {
    const at = sweepTouch(moving(rock, rockRadius(rock.size)), core);
    if (at !== null) recycleRock(sim, rock);
  }
}

/** The three lethal contacts: a rock, the saucer, and a saucer round. */
function resolveShipContacts(sim: Sim, ev: TickEvents): void {
  if (!shipIsVulnerable(sim)) return;
  const hull = moving(sim.ship, SHIP_R);

  for (const rock of sim.rocks) {
    if (sweepTouch(hull, moving(rock, rockRadius(rock.size))) !== null) {
      loseShip(sim, ev);
      return;
    }
  }

  const saucer = sim.saucer;
  if (
    saucer !== null &&
    sweepTouch(hull, moving(saucer, SAUCER_R, saucer.travel)) !== null
  ) {
    loseShip(sim, ev);
  }
}

/**
 * The slide along the core: solid, and never lethal.
 *
 * The ship is put back on the surface, the component of its velocity heading
 * into the core is removed, and the component along the surface is kept exactly
 * as it was. Its facing is untouched and the player keeps control throughout.
 */
function resolveShipAtTheCore(sim: Sim): void {
  const ship = sim.ship;
  const at = sweepInside(moving(ship, SHIP_R), fixed(STAR_X, STAR_Y, CORE_R));
  if (at === null) return;

  // Rewind to the moment of contact rather than resolving from wherever the
  // tick's full step left the ship.
  const dx = ship.vx * TICK_DT;
  const dy = ship.vy * TICK_DT;
  ship.x = wrapX(ship.x - dx + dx * at);
  ship.y = wrapY(ship.y - dy + dy * at);

  const [sx, sy] = separation(STAR_X, STAR_Y, ship.x, ship.y);
  const d = Math.hypot(sx, sy);
  const nx = d === 0 ? 0 : sx / d;
  const ny = d === 0 ? -1 : sy / d;

  const surface = CORE_R + SHIP_R;
  ship.x = wrapX(STAR_X + nx * surface);
  ship.y = wrapY(STAR_Y + ny * surface);

  const radial = ship.vx * nx + ship.vy * ny;
  if (radial < 0) {
    ship.vx -= radial * nx;
    ship.vy -= radial * ny;
  }
}

/** Step 6 of the tick: every pair, in the order the rules read in. */
export function resolveCollisions(sim: Sim, ev: TickEvents): void {
  resolveShipBullets(sim, ev);
  resolveEnemyBullets(sim, ev);
  resolveRocksAtTheCore(sim);
  resolveShipContacts(sim, ev);
  resolveShipAtTheCore(sim);
}
