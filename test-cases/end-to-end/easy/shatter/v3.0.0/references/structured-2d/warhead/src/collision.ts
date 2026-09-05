// Shatter — every impact on the field, and what it does.
//
// Collision is SWEPT: two bodies whose paths over a tick bring them within the
// sum of their radii at any point of that tick collide on it, however fast
// either was travelling and however far either moved (`specs/collision.md`). The
// motion each body made this tick is `src/motion.ts`; every separation is the
// shortest one across the seams, so a pair touching across a wrap collides like
// any other.
//
// A round resolves against the EARLIEST of the things it could have struck this
// tick, so a bullet that would cross a rock and then the core is taken by the
// rock.

import type { FrameCues } from "./audio";
import {
  BULLET_R,
  CORE_R,
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SCORE_SAUCER,
  SHIP_R,
  SPLIT_KICK,
  STAR_X,
  STAR_Y,
  TORPEDO_R,
  TORPEDO_SCATTER,
  HIT_FLASH_TIME,
} from "./constants";
import { addScore, loseLife } from "./flow";
import type {
  BulletState,
  RockState,
  ShatterState,
  TorpedoState,
} from "./game";
import { deltaX, deltaY, wrapX, wrapY } from "./geometry";
import { CORE, moveOf, sweptPair, type MoveTable } from "./motion";
import { destroyRock, recycleRock } from "./rocks";

/** What a round found in its path this tick. */
type RoundHit =
  { kind: "core" } | { kind: "rock"; rock: RockState } | { kind: "saucer" };

/**
 * The earliest thing a round strikes this tick, or `null` for a clear path.
 * The three candidates are the star's core, every rock on the field, and the
 * saucer; the ship is not among them for either of the ship's own weapons.
 */
function earliestHit(
  state: ShatterState,
  moves: MoveTable,
  round: BulletState | TorpedoState,
  radius: number,
): RoundHit | null {
  let best: RoundHit | null = null;
  let bestAt = Infinity;

  const core = sweptPair(moves, round, CORE, radius + CORE_R);
  if (core !== null) {
    best = { kind: "core" };
    bestAt = core;
  }

  for (const rock of state.rocks) {
    const at = sweptPair(moves, round, rock, radius + ROCK_RADIUS[rock.size]);
    if (at !== null && at < bestAt) {
      best = { kind: "rock", rock };
      bestAt = at;
    }
  }

  const saucer = state.saucer;
  if (saucer !== null) {
    const at = sweptPair(moves, round, saucer, radius + SAUCER_R);
    if (at !== null && at < bestAt) {
      best = { kind: "saucer" };
    }
  }

  return best;
}

/** Drop one round from its roster, by identity. */
function drop<T>(roster: T[], round: T): void {
  const index = roster.indexOf(round);
  if (index >= 0) roster.splice(index, 1);
}

/**
 * The ship's bullets.
 *
 * A hit on a rock lowers its health by exactly `1` and spends the round; only
 * the hit that takes health to `0` destroys the rock, which then splits and
 * scores. The fan a gun kill throws lies ACROSS the shot: the perpendicular is
 * taken from the bullet's own direction of travel rather than from the rock's
 * course.
 */
function resolveBullets(
  state: ShatterState,
  moves: MoveTable,
  cues: FrameCues,
): number {
  let destroyed = 0;

  for (const bullet of [...state.bullets]) {
    if (!state.bullets.includes(bullet)) continue;

    const hit = earliestHit(state, moves, bullet, BULLET_R);
    if (hit === null) continue;
    drop(state.bullets, bullet);

    if (hit.kind === "saucer") {
      state.saucer = null;
      addScore(state, SCORE_SAUCER, cues);
      continue;
    }
    if (hit.kind === "core") continue;

    const rock = hit.rock;
    rock.health -= 1;
    if (rock.health > 0) {
      rock.flash = HIT_FLASH_TIME;
      continue;
    }

    const travel = Math.hypot(bullet.vx, bullet.vy);
    const kickX = travel === 0 ? 0 : -bullet.vy / travel;
    const kickY = travel === 0 ? 1 : bullet.vx / travel;
    destroyRock(state, rock, kickX, kickY, SPLIT_KICK, cues);
    destroyed += 1;
  }

  return destroyed;
}

/**
 * The torpedoes.
 *
 * A torpedo destroys the rock it strikes outright, whatever its size or
 * remaining health, and only that rock. Its fan is radial: the two fragments are
 * blasted to opposite sides along the line through the destroyed rock's centre
 * and the point the torpedo reached it at.
 */
function resolveTorpedoes(
  state: ShatterState,
  moves: MoveTable,
  cues: FrameCues,
): number {
  let destroyed = 0;

  for (const torpedo of [...state.torpedoes]) {
    if (!state.torpedoes.includes(torpedo)) continue;

    const hit = earliestHit(state, moves, torpedo, TORPEDO_R);
    if (hit === null) continue;
    drop(state.torpedoes, torpedo);

    if (hit.kind === "saucer") {
      state.saucer = null;
      addScore(state, SCORE_SAUCER, cues);
      continue;
    }
    if (hit.kind === "core") continue;

    const rock = hit.rock;
    const outX = deltaX(rock.x, torpedo.x);
    const outY = deltaY(rock.y, torpedo.y);
    const reach = Math.hypot(outX, outY);
    const travel = Math.hypot(torpedo.vx, torpedo.vy);
    const kickX =
      reach === 0 ? (travel === 0 ? 1 : torpedo.vx / travel) : outX / reach;
    const kickY =
      reach === 0 ? (travel === 0 ? 0 : torpedo.vy / travel) : outY / reach;

    rock.health = 0;
    destroyRock(state, rock, kickX, kickY, TORPEDO_SCATTER, cues);
    destroyed += 1;
  }

  return destroyed;
}

/** The saucer's bullets: absorbed by the core, and harmless to everything but the ship. */
function resolveEnemyBullets(state: ShatterState, moves: MoveTable): void {
  for (const bullet of [...state.enemyBullets]) {
    if (sweptPair(moves, bullet, CORE, SAUCER_BULLET_R + CORE_R) !== null) {
      drop(state.enemyBullets, bullet);
    }
  }
}

/** A rock the star swallows: recycled, scoring nothing and leaving the count alone. */
function resolveRocksAtCore(state: ShatterState, moves: MoveTable): void {
  for (const rock of state.rocks) {
    if (
      sweptPair(moves, rock, CORE, CORE_R + ROCK_RADIUS[rock.size]) === null
    ) {
      continue;
    }
    recycleRock(state, rock);
    // It is somewhere else entirely now, so the motion it made this tick no
    // longer describes a path anything should be tested against.
    moves.delete(rock);
  }
}

/**
 * The slide along the core.
 *
 * The core is solid but never lethal to the ship: the ship's centre is pushed
 * back out to `CORE_R + SHIP_R` from the star's centre, the component of its
 * velocity heading into the core is removed, the component along the surface is
 * kept, and its facing is untouched.
 */
function resolveShipCore(state: ShatterState, moves: MoveTable): void {
  const ship = state.ship;
  const limit = CORE_R + SHIP_R;

  if (sweptPair(moves, ship, CORE, limit) === null) return;

  let outX = deltaX(STAR_X, ship.x);
  let outY = deltaY(STAR_Y, ship.y);
  let distance = Math.hypot(outX, outY);

  if (distance >= limit) {
    // It passed through within the tick rather than ending inside: take it back
    // to where its circle met the core and resolve the contact there.
    const at = sweptPair(moves, ship, CORE, limit) ?? 0;
    const move = moveOf(moves, ship);
    ship.x = wrapX(ship.x - move.x * (1 - at));
    ship.y = wrapY(ship.y - move.y * (1 - at));
    outX = deltaX(STAR_X, ship.x);
    outY = deltaY(STAR_Y, ship.y);
    distance = Math.hypot(outX, outY);
  }

  if (distance === 0) {
    outX = 0;
    outY = -1;
    distance = 1;
  }

  const nx = outX / distance;
  const ny = outY / distance;
  ship.x = wrapX(STAR_X + nx * limit);
  ship.y = wrapY(STAR_Y + ny * limit);

  const inward = ship.vx * nx + ship.vy * ny;
  if (inward < 0) {
    ship.vx -= inward * nx;
    ship.vy -= inward * ny;
  }
}

/**
 * The three lethal contacts: a rock, the saucer, and a saucer bullet. Each costs
 * one life. Inside the respawn grace, and with the ship's contact gate off, the
 * ship passes through all three unharmed.
 */
function resolveShipContacts(
  state: ShatterState,
  moves: MoveTable,
  cues: FrameCues,
): void {
  const ship = state.ship;
  if (!ship.collision || ship.invuln > 0) return;

  for (const rock of state.rocks) {
    if (
      sweptPair(moves, ship, rock, SHIP_R + ROCK_RADIUS[rock.size]) !== null
    ) {
      loseLife(state, cues);
      return;
    }
  }

  const saucer = state.saucer;
  if (
    saucer !== null &&
    sweptPair(moves, ship, saucer, SHIP_R + SAUCER_R) !== null
  ) {
    loseLife(state, cues);
    return;
  }

  for (const bullet of [...state.enemyBullets]) {
    if (sweptPair(moves, ship, bullet, SHIP_R + SAUCER_BULLET_R) !== null) {
      drop(state.enemyBullets, bullet);
      loseLife(state, cues);
      return;
    }
  }
}

/**
 * Step 6 of the tick. Returns how many rocks were destroyed on it, which is what
 * decides whether the wave turned over: a wave clears on the tick in which the
 * last rock is destroyed, and an emptied field that had nothing destroyed on it
 * is a wave being played (`specs/progression.md`).
 */
export function resolveCollisions(
  state: ShatterState,
  moves: MoveTable,
  cues: FrameCues,
): number {
  resolveShipCore(state, moves);

  let destroyed = 0;
  destroyed += resolveBullets(state, moves, cues);
  destroyed += resolveTorpedoes(state, moves, cues);
  resolveEnemyBullets(state, moves);
  resolveRocksAtCore(state, moves);
  resolveShipContacts(state, moves, cues);

  return destroyed;
}
