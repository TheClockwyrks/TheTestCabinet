// Shatter — every impact and what it does (`specs/collision.md`).
//
// Two properties of this file carry most of its weight.
//
// SWEPT, NOT SAMPLED. Every pair is decided by where the two bodies were, where
// they ended, and whether their paths brought them within the sum of their radii
// at ANY point of the tick. The figures make that necessary rather than tidy: a
// bullet of radius 3 leaving a capped ship travels 10 units in a tick, so an
// overlap test at the end of the tick passes straight through a Small rock, and
// a rock closing on the ship at the same speed passes through the ship.
//
// ACROSS THE SEAM. Every separation is the shortest one across the wrap
// (`specs/field.md`), so bodies touching at opposite edges of the field collide.
// The relative motion is taken from each body's recorded movement rather than
// from the difference of its positions, because a body that crossed a seam has a
// position that jumped a field width while its travel was one tick's worth.
//
// The resolution of each pair is `specs/collision.md`'s table, in its order. A
// body that can hit several things in one tick resolves the EARLIEST of them, so
// a bullet that would reach both a rock and the core takes whichever it actually
// reached first.

import {
  BULLET_R,
  CORE_R,
  HIT_FLASH_TIME,
  SAUCER_BULLET_R,
  SAUCER_R,
  SCORE_SAUCER,
  SHIP_R,
  SPLIT_KICK,
  STAR_X,
  STAR_Y,
  TORPEDO_R,
  TORPEDO_SCATTER,
  CUES,
} from "./constants";
import { deltaX, deltaY, sweptTime } from "./geometry";
import { destroyRock, radiusOf, recycleRock } from "./rocks";
import { respawnShip } from "./ship";
import { saucerLeft } from "./saucer";
import { award } from "./scoring";
import {
  NO_MOVE,
  moveOf,
  type FrameEvents,
  type Move,
  type Moves,
  type MutBullet,
  type MutRock,
  type Sim,
} from "./sim";

/** When in the tick two circles first touched, or `Infinity` for never. */
function contactTime(
  ax: number,
  ay: number,
  am: Move,
  bx: number,
  by: number,
  bm: Move,
  r: number,
): number {
  const wx = bm.mx - am.mx;
  const wy = bm.my - am.my;
  const endX = deltaX(ax, bx);
  const endY = deltaY(ay, by);
  const t = sweptTime(endX - wx, endY - wy, wx, wy, r);
  return t === null ? Infinity : t;
}

/** Drop one entry from a roster, by identity. */
function drop<T>(roster: T[], entry: T): void {
  const index = roster.indexOf(entry);
  if (index >= 0) roster.splice(index, 1);
}

/** The unit vector a round was travelling along when it landed. */
function travelOf(bullet: MutBullet): readonly [number, number] {
  const speed = Math.hypot(bullet.vx, bullet.vy);
  if (speed === 0) return [1, 0];
  return [bullet.vx / speed, bullet.vy / speed];
}

/** Take the ship: a life is lost, and the next one goes up if there is one. */
function killShip(sim: Sim, events: FrameEvents): void {
  sim.lives -= 1;
  events.cues.add(CUES.death);

  if (sim.lives > 0) {
    respawnShip(sim);
  } else {
    sim.lives = 0;
    sim.screen = "gameover";
    sim.menuIndex = 0;
  }
}

/** Whether a contact with the ship is lethal this tick. */
function shipIsVulnerable(sim: Sim): boolean {
  return sim.screen === "playing" && sim.ship.collision && sim.ship.invuln <= 0;
}

/** The ship's bullets: the core, the saucer, and the rocks. */
function resolveBullets(sim: Sim, moves: Moves, events: FrameEvents): void {
  for (const bullet of [...sim.bullets]) {
    if (!sim.bullets.includes(bullet)) continue;
    const bm = moveOf(moves, bullet.id);

    let best = contactTime(
      bullet.x,
      bullet.y,
      bm,
      STAR_X,
      STAR_Y,
      NO_MOVE,
      BULLET_R + CORE_R,
    );
    let hitRock: MutRock | null = null;
    let hitSaucer = false;

    const saucer = sim.saucer;
    if (saucer !== null) {
      const t = contactTime(
        bullet.x,
        bullet.y,
        bm,
        saucer.x,
        saucer.y,
        moves.saucer,
        BULLET_R + SAUCER_R,
      );
      if (t < best) {
        best = t;
        hitSaucer = true;
      }
    }

    for (const rock of sim.rocks) {
      const t = contactTime(
        bullet.x,
        bullet.y,
        bm,
        rock.x,
        rock.y,
        moveOf(moves, rock.id),
        BULLET_R + radiusOf(rock.size),
      );
      if (t < best) {
        best = t;
        hitRock = rock;
        hitSaucer = false;
      }
    }

    if (best === Infinity) continue;
    drop(sim.bullets, bullet);

    if (hitSaucer) {
      award(sim, SCORE_SAUCER, events);
      saucerLeft(sim);
      continue;
    }
    if (hitRock === null) continue; // Absorbed by the core: nothing scores.

    hitRock.health -= 1;
    hitRock.flash = HIT_FLASH_TIME;
    if (hitRock.health > 0) continue;

    const [ux, uy] = travelOf(bullet);
    destroyRock(sim, hitRock, -uy * SPLIT_KICK, ux * SPLIT_KICK, events);
  }
}

/** The torpedoes: the core, the saucer, and the rocks. A rock goes outright. */
function resolveTorpedoes(sim: Sim, moves: Moves, events: FrameEvents): void {
  for (const torpedo of [...sim.torpedoes]) {
    if (!sim.torpedoes.includes(torpedo)) continue;
    const tm = moveOf(moves, torpedo.id);

    let best = contactTime(
      torpedo.x,
      torpedo.y,
      tm,
      STAR_X,
      STAR_Y,
      NO_MOVE,
      TORPEDO_R + CORE_R,
    );
    let hitRock: MutRock | null = null;
    let hitSaucer = false;

    const saucer = sim.saucer;
    if (saucer !== null) {
      const t = contactTime(
        torpedo.x,
        torpedo.y,
        tm,
        saucer.x,
        saucer.y,
        moves.saucer,
        TORPEDO_R + SAUCER_R,
      );
      if (t < best) {
        best = t;
        hitSaucer = true;
      }
    }

    for (const rock of sim.rocks) {
      const t = contactTime(
        torpedo.x,
        torpedo.y,
        tm,
        rock.x,
        rock.y,
        moveOf(moves, rock.id),
        TORPEDO_R + radiusOf(rock.size),
      );
      if (t < best) {
        best = t;
        hitRock = rock;
        hitSaucer = false;
      }
    }

    if (best === Infinity) continue;
    drop(sim.torpedoes, torpedo);

    if (hitSaucer) {
      award(sim, SCORE_SAUCER, events);
      saucerLeft(sim);
      continue;
    }
    if (hitRock === null) continue; // Absorbed by the core: nothing scores.

    // The blast throws the two fragments apart along the torpedo's own course,
    // away from the centre of the rock it destroyed, and it destroys only that
    // rock however close its neighbors stand.
    destroyRock(
      sim,
      hitRock,
      Math.cos(torpedo.heading) * TORPEDO_SCATTER,
      Math.sin(torpedo.heading) * TORPEDO_SCATTER,
      events,
    );
  }
}

/** The saucer's bullets: the core, and the ship. They pass over the rocks. */
function resolveEnemyBullets(
  sim: Sim,
  moves: Moves,
  events: FrameEvents,
): void {
  for (const bullet of [...sim.enemyBullets]) {
    if (!sim.enemyBullets.includes(bullet)) continue;
    const bm = moveOf(moves, bullet.id);

    const toCore = contactTime(
      bullet.x,
      bullet.y,
      bm,
      STAR_X,
      STAR_Y,
      NO_MOVE,
      SAUCER_BULLET_R + CORE_R,
    );
    const toShip = contactTime(
      bullet.x,
      bullet.y,
      bm,
      sim.ship.x,
      sim.ship.y,
      moves.ship,
      SAUCER_BULLET_R + SHIP_R,
    );

    if (toCore <= toShip) {
      if (toCore !== Infinity) drop(sim.enemyBullets, bullet);
      continue;
    }
    // A ship inside its grace, or with its contact test gated off, is passed
    // through: nothing is lost and the round stays in flight.
    if (!shipIsVulnerable(sim)) continue;

    drop(sim.enemyBullets, bullet);
    killShip(sim, events);
    return;
  }
}

/** A rock that reaches the core is recycled, at the same size and health. */
function resolveRocksAtCore(sim: Sim, moves: Moves): void {
  for (const rock of sim.rocks) {
    const t = contactTime(
      rock.x,
      rock.y,
      moveOf(moves, rock.id),
      STAR_X,
      STAR_Y,
      NO_MOVE,
      CORE_R + radiusOf(rock.size),
    );
    if (t !== Infinity) recycleRock(sim, rock);
  }
}

/** The ship against a rock and against the saucer: both take a life. */
function resolveShipContacts(
  sim: Sim,
  moves: Moves,
  events: FrameEvents,
): boolean {
  if (!shipIsVulnerable(sim)) return false;

  for (const rock of sim.rocks) {
    const t = contactTime(
      sim.ship.x,
      sim.ship.y,
      moves.ship,
      rock.x,
      rock.y,
      moveOf(moves, rock.id),
      SHIP_R + radiusOf(rock.size),
    );
    if (t !== Infinity) {
      killShip(sim, events);
      return true;
    }
  }

  const saucer = sim.saucer;
  if (saucer !== null) {
    const t = contactTime(
      sim.ship.x,
      sim.ship.y,
      moves.ship,
      saucer.x,
      saucer.y,
      moves.saucer,
      SHIP_R + SAUCER_R,
    );
    if (t !== Infinity) {
      killShip(sim, events);
      return true;
    }
  }
  return false;
}

/**
 * The slide along the core: solid, and never lethal.
 *
 * The ship is pushed back out to exactly `CORE_R + SHIP_R` from the star, the
 * component of its velocity heading into the core is removed and the component
 * along the surface kept, and its facing is untouched. It runs whether or not
 * the ship's lethal contact test is gated on, because it is a separate,
 * non-lethal interaction.
 */
function resolveShipAtCore(sim: Sim): void {
  const ship = sim.ship;
  const dx = ship.x - STAR_X;
  const dy = ship.y - STAR_Y;
  const d = Math.hypot(dx, dy);
  const standoff = CORE_R + SHIP_R;
  if (d >= standoff) return;

  const [nx, ny] = d === 0 ? [0, -1] : [dx / d, dy / d];
  ship.x = STAR_X + nx * standoff;
  ship.y = STAR_Y + ny * standoff;

  const inward = ship.vx * nx + ship.vy * ny;
  if (inward < 0) {
    ship.vx -= inward * nx;
    ship.vy -= inward * ny;
  }
}

/** Resolve every pair `specs/collision.md` names, in its order. */
export function resolveCollisions(
  sim: Sim,
  moves: Moves,
  events: FrameEvents,
): void {
  resolveBullets(sim, moves, events);
  resolveTorpedoes(sim, moves, events);
  resolveEnemyBullets(sim, moves, events);
  resolveRocksAtCore(sim, moves);
  const died = resolveShipContacts(sim, moves, events);
  if (!died) resolveShipAtCore(sim);
}
