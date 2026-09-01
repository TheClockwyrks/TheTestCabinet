// sconce/flight — a posed sconce in flight, shared by the motion checks in
// this directory. CASE-PROVIDED.
//
// WHAT THE MOTION CHECKS SHARE. `specs/weapons.md` ("Sconce"): a sconce's
// "velocity along `d` falls under a constant acceleration of `−SCONCE_DECEL`
// (`600`) units per second squared, integrated per tick as Projectiles and
// pierce states, position first and then velocity, so after `n` moving ticks
// its velocity is `(speed − SCONCE_DECEL × n × TICK_DT) × d`". Every check on
// that rule poses a sconce at a known point flying at `SCONCE_SPEED` along a
// known direction, turns `effectMotion` on so "the sconces decelerate"
// (`specs/world.md`, phase 6), and reads the sconce tick by tick. The
// arrangement is spelled once here and decides nothing: the sconce is placed
// through `spawnProjectile`, which gives it "acceleration `−SCONCE_DECEL`
// along the unit vector of `(vx, vy)`" (`specs/instrumentation.md`) exactly as
// a launch does, with `INFINITE_PIERCE` as a launched sconce carries, and the
// real ticks move it.
//
// WHY A POSED SCONCE AND NOT A LAUNCHED ONE. Which direction a launch takes,
// and which figures the row gives it, are the launch checks' points. A posed
// sconce starts from a point and a velocity the check names, so the tick a
// figure is read on is decided by arithmetic alone.
// `specs/instrumentation.md`: a posed projectile "first moves ... on the next
// tick, exactly as one a tick created".
//
// WHY THESE FIGURES ARE THE LEVEL-1 ONES. With Sconce unheld a posed sconce
// takes "the weapon's table radius at the level held, or at level `1` ... when
// the weapon is not held" (`specs/instrumentation.md`), so its `radius`,
// `damage`, and `ttl` are row 1's: 12, 12, and 2.5. `SCONCE_SPEED` is that
// same row's `speed` of 600, so a sconce posed at it is a level-1 sconce
// launched at its table speed. Its `ttl` of 2.5 seconds is `round(2.5 × 60)`
// = 150 ticks (`specs/world.md`, Timers), so it outlives every trace here.

import {
  INFINITE_PIERCE,
  SCONCE_DECEL,
  SCONCE_LEVELS,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  enable,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
  type Point,
  type SnapshotProjectile,
  type WickSnapshot,
} from "../harness";

/** The speed a posed sconce flies at: level 1's `speed`, 600. */
export const SCONCE_SPEED = SCONCE_LEVELS[0].speed;

/** How far a sconce at `SCONCE_SPEED` moves on its first tick: `600 × TICK_DT`. */
export const FIRST_STEP = SCONCE_SPEED * TICK_DT;

/**
 * The tick the reversal lands on: `speed / SCONCE_DECEL` seconds of motion,
 * `600 / 600` = 1 second, which is `round(1 × 60)` = 60 ticks
 * (`specs/world.md`, Timers).
 */
export const REVERSAL_TICK = Math.round(
  (SCONCE_SPEED / SCONCE_DECEL) * (1 / TICK_DT),
);

/** The component of `(x, y)` along the unit vector `d`. */
export function along(x: number, y: number, d: Point): number {
  return x * d.x + y * d.y;
}

/** The speed along `d` after `n` moving ticks: `speed − SCONCE_DECEL × n × TICK_DT`. */
export function speedAfter(n: number): number {
  return SCONCE_SPEED - SCONCE_DECEL * n * TICK_DT;
}

/**
 * How far along `d` a sconce has advanced after `n` moving ticks: the sum of
 * the velocity each tick moved at, since "a projectile's position advances by
 * its velocity times `TICK_DT`, then its velocity changes by its acceleration
 * times `TICK_DT`" (`specs/world.md`, phase 6), so tick `k + 1` moves at
 * `speedAfter(k)`.
 */
export function advanceAfter(n: number): number {
  let along = 0;
  for (let k = 0; k < n; k += 1) along += speedAfter(k) * TICK_DT;
  return along;
}

/**
 * Pose an isolated run with `effectMotion` on and nothing else running: no
 * enemy to hit, no weapon to fire, no director. The lamplighter's center is
 * where the run began, and a sconce placed relative to it flies over an empty
 * plane.
 */
export function poseFlight(h: Harness): WickSnapshot {
  isolate(h);
  enable(h, "effectMotion");
  return h.snapshot();
}

/** Place one sconce at `(x, y)` flying at `speed` along `d`, answering its id. */
export function placeSconce(
  h: Harness,
  x: number,
  y: number,
  d: Point,
  speed = SCONCE_SPEED,
): number {
  return placeProjectile(
    h,
    "sconce",
    x,
    y,
    speed * d.x,
    speed * d.y,
    INFINITE_PIERCE,
  );
}

/**
 * Run `ticks` ticks one at a time and read sconce `id` after each. Entry `i`
 * is the sconce after tick `i + 1`; a sconce that is gone fails the check that
 * reads it, since a posed sconce's `ttl` of 2.5 seconds is 150 ticks and
 * outlives any trace here.
 */
export async function traceSconce(
  h: Harness,
  id: number,
  ticks: number,
): Promise<SnapshotProjectile[]> {
  const trace: SnapshotProjectile[] = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    const s = await advanceTicks(h, 1);
    const sconce = projectileById(s, id);
    if (sconce === undefined) {
      throw new Error(
        `Expected: the posed sconce still in the world after tick ${tick} (specs/weapons.md, Sconce)\nActual: gone`,
      );
    }
    trace.push(sconce);
  }
  return trace;
}
