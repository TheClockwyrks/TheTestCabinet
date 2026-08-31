// lives/duel — the quiet ground the lethal-contact items stage a death on, and
// the two sweeps that watch one happen.
//
// Every item in this group that is about a life being lost, or about the ship
// that follows, needs the same three things arranged: a ship standing somewhere
// the environment cannot touch it, one body closing on it, and the ship's lethal
// contact test switched back ON. This module owns that arrangement. It fixes
// GEOMETRY and never a threshold: every figure an item asserts is stated in that
// item, derived from what `specs/` fixes for it.
//
// WHY THE SHIP IS NOT LEFT AT THE SAFE POINT. `startPlaying` poses it there, and
// the respawn items have to be able to tell a ship that MOVED to the safe point
// from a ship that was already standing on it. So a duel is fought at
// {@link DUEL}, 481 units from `(SAFE_X, SAFE_Y)` by the shortest wrapped
// separation and 385 from the star — far outside `HALO_R`, far outside anything
// the core does, and far enough that no reading here can confuse the two places.
//
// WHY THE ATTACKER COMES IN FROM THE SIDE FACING AWAY FROM THE STAR. Its whole
// approach is then a fall INWARD, so the well adds a fraction of a unit along the
// line it was already travelling and never bends it off the ship. `aimedRound`
// in the harness places a round the same way and for a related reason; this is
// that idea applied to a body that is closing on the ship rather than on a rock.
//
// WHY THE ATTACKER CARRIES THE SHIP'S OWN VELOCITY. The respawn items pose a
// ship that is MOVING when it dies — that is what makes "the next ship appears at
// rest" a reading rather than a tautology — and an attacker aimed at where the
// ship stood would miss a ship that is going somewhere. Adding the ship's
// velocity to the closing component makes the closing speed exactly
// {@link CLOSING_SPEED} whatever the ship is doing.
//
// The ship's lethal contact test is the REQUIREMENT of every item that uses this
// module, which is why they are among the few in this case that turn a gate back
// on. `setShipCollision` gates that test and nothing else
// (`specs/instrumentation.md`), and the respawn grace is posed separately, so
// what the contact does here is decided by the game's own collision rules.

import {
  ROCK_RADIUS,
  SAUCER_BULLET_R,
  SAUCER_R,
  SHIP_R,
} from "../../src/constants";
import { fail } from "../assert";
import {
  distanceToSegment,
  shortestSeparation,
  wrappedDistance,
  STAR,
  type Vec,
} from "../geometry";
import {
  captureStill,
  poseEnemyBullet,
  poseRock,
  poseSaucer,
  poseShip,
  rockById,
  startPlaying,
  type Harness,
  type RockSize,
  type ShatterSnapshot,
  type ShipSnapshot,
} from "../harness";

/** The ground a duel is fought on: quiet, far from the star, far from the safe point. */
export const DUEL: Vec = { x: 300, y: 180 };

/**
 * The speed the ship is flying at when it dies, in units per second.
 *
 * Only the respawn items ask for it. It is well under `SHIP_MAX` (`680`), so it
 * is a state a player reaches, and far above the `1` unit per second
 * `lives/respawns-at-rest` allows a respawned ship — the drag alone takes only
 * 4 percent off it over the quarter-second those items watch.
 */
export const DEATH_SPEED = 160;

/**
 * The facing the ship carries into a duel: along `+x`.
 *
 * A right angle from `FACE_UP` (`-90` degrees), so `lives/respawns-facing-up`
 * reads a facing the respawn had to set rather than one the pose already held.
 */
export const DEATH_HEADING = 0;

/** The speed the attacker closes on the ship at, in units per second. */
const CLOSING_SPEED = 240;

/** The gap between the attacker's surface and the ship's when it is posed. */
const STANDOFF = 40;

/** The direction from the star out to the duel: the side an attacker comes in from. */
const AWAY_FROM_STAR = ((): Vec => {
  const d = shortestSeparation(STAR, DUEL);
  const length = Math.hypot(d.x, d.y);
  return { x: d.x / length, y: d.y / length };
})();

/** Live play, and a ship at the duel ground with its lethal contact test ON. */
export function poseDuel(
  h: Harness,
  pose: { vx?: number; vy?: number; angle?: number } = {},
): void {
  startPlaying(h);
  poseShip(h, {
    x: DUEL.x,
    y: DUEL.y,
    vx: pose.vx ?? 0,
    vy: pose.vy ?? 0,
    angle: pose.angle ?? DEATH_HEADING,
  });
  h.debug.setShipInvuln(0);
  h.debug.setShipCollision(true);
}

/** Where a body is posed: `centres` units from the ship, on the far side from the star. */
function doorstep(centres: number): Vec {
  return {
    x: DUEL.x + AWAY_FROM_STAR.x * centres,
    y: DUEL.y + AWAY_FROM_STAR.y * centres,
  };
}

/** The velocity a body posed on the doorstep closes on the ship with. */
function closing(h: Harness, speed: number = CLOSING_SPEED): Vec {
  const ship = h.snapshot().ship;
  return {
    x: ship.vx - AWAY_FROM_STAR.x * speed,
    y: ship.vy - AWAY_FROM_STAR.y * speed,
  };
}

/**
 * One rock posed `centres` units from the ship's centre and closing on it at
 * `speed`, and its id.
 *
 * The range and the closing speed are the CALLER's, because an item that is
 * about how fast a body may close before a build stops noticing it has to state
 * both itself. {@link poseClosingRock} is the ordinary form.
 */
export function poseRockAtRange(
  h: Harness,
  size: RockSize,
  centres: number,
  speed: number,
): number {
  const at = doorstep(centres);
  const v = closing(h, speed);
  return poseRock(h, size, at.x, at.y, v.x, v.y);
}

/** One rock on the ship's doorstep, closing on it, and its id. */
export function poseClosingRock(h: Harness, size: RockSize = "small"): number {
  return poseRockAtRange(
    h,
    size,
    SHIP_R + ROCK_RADIUS[size] + STANDOFF,
    CLOSING_SPEED,
  );
}

/** The saucer on the ship's doorstep, closing on it, and its id. */
export function poseClosingSaucer(h: Harness): number {
  const at = doorstep(SHIP_R + SAUCER_R + STANDOFF);
  const id = poseSaucer(h, at.x, at.y);
  // Its steering and its gun are held: this scenario is about the saucer's HULL
  // reaching the ship. A saucer left to steer would weave off the line, and one
  // left to fire could take the ship with a bullet instead — which is
  // `lives/a-saucer-bullet-costs-a-life`'s point, not this one.
  h.debug.setSaucerMind(false);
  h.debug.setSaucerGun(false);
  const v = closing(h);
  h.debug.setSaucerVelocity(v.x, v.y);
  return id;
}

/** One saucer bullet on the ship's doorstep, closing on it, and its id. */
export function poseClosingEnemyBullet(h: Harness): number {
  const at = doorstep(SHIP_R + SAUCER_BULLET_R + STANDOFF);
  const v = closing(h);
  return poseEnemyBullet(h, at.x, at.y, v.x, v.y);
}

/** What one tick-by-tick watch of a closing body saw. */
export interface ContactWatch {
  /** The tick `lives` first fell, or `-1` if it never did. */
  lostAt: number;
  /**
   * The least the attacker's PATH came to the ship's centre, in units.
   *
   * Measured to the segment between two consecutive readings rather than to the
   * readings themselves, because the closest point of an approach falls between
   * two samples far more often than on one — the same correction
   * `geometry.ts`'s `distanceToSegment` exists for.
   */
  closest: number;
  /** The snapshot the watch ended on. */
  end: ShatterSnapshot;
}

/** How a watch is bounded, what it follows, and what picture it keeps. */
export interface ContactOptions {
  /** The most ticks the watch advances. */
  maxTicks: number;
  /** The attacker's collision radius, for the surface gap `still` fires on. */
  radius: number;
  /** The attacker, read fresh from each tick's snapshot. */
  read: (snapshot: ShatterSnapshot) => Vec | undefined;
  /** Keep watching after a life is lost. The watch stops there by default. */
  follow?: boolean;
  /** Keep one still the first tick the attacker's surface is `gap` from the ship's. */
  still?: { id: string; gap: number };
}

/**
 * Advance a tick at a time while a posed body closes on the ship, and answer
 * what happened.
 *
 * It ASSERTS NOTHING. Whether the contact should have cost a life, and whether
 * the path came close enough for the question to mean anything, is each item's
 * to state against the rule it is deciding.
 */
export async function watchContact(
  h: Harness,
  options: ContactOptions,
): Promise<ContactWatch> {
  const opening = h.snapshot();
  const lives = opening.lives;
  let previous = options.read(opening);
  let closest = Number.POSITIVE_INFINITY;
  let lostAt = -1;
  let kept = options.still === undefined;
  let end = opening;

  for (let tick = 1; tick <= options.maxTicks; tick += 1) {
    await h.advance(1);
    end = h.snapshot();

    const ship: Vec = { x: end.ship.x, y: end.ship.y };
    const at = options.read(end);
    if (at !== undefined) {
      const from = previous ?? at;
      closest = Math.min(
        closest,
        distanceToSegment(
          { x: 0, y: 0 },
          shortestSeparation(ship, from),
          shortestSeparation(ship, at),
        ),
      );
      if (!kept && options.still !== undefined) {
        const surfaces = wrappedDistance(ship, at) - (SHIP_R + options.radius);
        if (surfaces <= options.still.gap) {
          captureStill(h, options.still.id);
          kept = true;
        }
      }
      previous = at;
    }

    if (lostAt < 0 && end.lives < lives) {
      lostAt = tick;
      if (options.follow !== true) break;
    }
  }

  if (!kept && options.still !== undefined) captureStill(h, options.still.id);
  return { lostAt, closest, end };
}

/**
 * The velocity a ship carries into a duel it is meant to lose: `DEATH_SPEED`
 * along `+x`.
 *
 * A ship that dies STANDING STILL would make "the next ship appears at rest"
 * true before the respawn ran, so every item about the ship that follows a death
 * poses one that is going somewhere.
 */
const DEATH_VELOCITY: Vec = { x: DEATH_SPEED, y: 0 };

/**
 * A ship flying at the duel ground, and a rock posed to reach it. Answers the
 * rock's id, which {@link watchTheDeath} follows.
 *
 * The arrangement every item about the ship that FOLLOWS a death stands on: the
 * ship is moving, facing a right angle away from `FACE_UP`, and standing 481
 * units from the safe point, so each of the three properties the respawn is
 * required to set is a property the pose did not already have.
 *
 * Posing and driving are two calls rather than one so a check can read the
 * arrangement it is about to drive — how far from the safe point the ship
 * really stands, how fast it really is going — before a tick runs.
 */
export function poseLosingDuel(h: Harness): number {
  poseDuel(h, {
    vx: DEATH_VELOCITY.x,
    vy: DEATH_VELOCITY.y,
    angle: DEATH_HEADING,
  });
  return poseClosingRock(h);
}

/**
 * Advance until the posed rock costs the ship a life, and answer what was seen.
 *
 * It asserts nothing. That a life was lost at all is each item's precondition to
 * state, and every item that uses this states it.
 */
export async function watchTheDeath(
  h: Harness,
  rockId: number,
  maxTicks: number,
): Promise<ContactWatch> {
  return watchContact(h, {
    maxTicks,
    radius: ROCK_RADIUS.small,
    read: (snapshot) => rockById(snapshot, rockId),
  });
}

/** What a watch for the ship the respawn puts up saw. */
export interface RespawnWatch {
  /** The least the ship's centre came to the safe point, in units. */
  closest: number;
  /**
   * The most respawn grace the ship was seen carrying over the watch, in
   * seconds.
   *
   * The reading for a window's OPENING value that does not depend on which tick
   * the window opened on: a grace that opens at some tick inside the watch and
   * counts down from there is at its opening value on that tick, so the maximum
   * over the watch is that value less at most the one tick of countdown that may
   * run inside the tick it opened in.
   */
  mostGrace: number;
  /** The first snapshot the ship stood within `mark` of the safe point in. */
  at?: ShatterSnapshot;
  /** Ticks advanced when the watch ended. */
  ticks: number;
  /** The snapshot the watch ended on. */
  end: ShatterSnapshot;
}

/**
 * Watch the ship for `maxTicks` from wherever the game stands, and answer how
 * close it came to the safe point and what it looked like when it got there.
 *
 * The reading STARTS BEFORE ANY FRAME RUNS, so a build that puts the next ship
 * up on the very tick the life fell is read on that tick and a build that takes
 * a few more is read when it gets there.
 *
 * `mark` is a MARKER and not a tolerance: it answers "a ship appeared at the
 * safe point", which is what tells the respawn apart from the duel ground 481
 * units away. How close to `(SAFE_X, SAFE_Y)` that ship has to stand is
 * `lives/respawns-at-the-safe-point`'s own figure, asserted there off
 * {@link RespawnWatch.closest}.
 */
export async function watchForRespawn(
  h: Harness,
  safe: Vec,
  mark: number,
  maxTicks: number,
): Promise<RespawnWatch> {
  let end = h.snapshot();
  let closest = wrappedDistance({ x: end.ship.x, y: end.ship.y }, safe);
  let mostGrace = end.ship.invuln;
  let at = closest <= mark ? end : undefined;
  let ticks = 0;

  for (let tick = 1; tick <= maxTicks; tick += 1) {
    await h.advance(1);
    ticks = tick;
    end = h.snapshot();
    const distance = wrappedDistance({ x: end.ship.x, y: end.ship.y }, safe);
    closest = Math.min(closest, distance);
    mostGrace = Math.max(mostGrace, end.ship.invuln);
    if (at === undefined && distance <= mark) at = end;
  }

  return { closest, mostGrace, at, ticks, end };
}

/**
 * The ship a respawn put up, or a failure naming the rule that owes one.
 *
 * The `require...` form the harness's readings come in, for the same reason:
 * a check that dereferenced whatever came back would crash on a build that put
 * no ship up, and a crashed suite is reported as a build with no debug surface
 * — a different and much worse verdict than the true one.
 */
export function requireRespawnedShip(watch: RespawnWatch): ShipSnapshot {
  if (watch.at === undefined) {
    fail(
      "a next ship standing at the safe point after a life was lost with " +
        "ships remaining (specs/progression.md)",
      `the ship was still ${watch.closest.toFixed(1)} units away ` +
        `${watch.ticks} ticks later`,
    );
  }
  return watch.at.ship;
}
