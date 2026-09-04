// shard/bounce — what the four bounce points of this category share: the view
// rectangle a shard is kept inside, a shard posed on the way to one of its
// edges, and the step such a shard takes on a tick. CASE-PROVIDED.
//
// No review item names this file. The pose is a compound sequence of the
// surface's atomic operations, which the authoring guide has live beside the
// checks rather than inside any one of them.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "While alive a shard stays inside the view:
//     the `STAGE_W × STAGE_H` (`1280 × 720`) rectangle centered on the player's
//     center on that tick, after the lamplighter has moved. After the shard's
//     move on a tick, a center past an edge of that rectangle is clamped to
//     that edge, and the velocity component across that edge reverses when it
//     points outward and is left as it is when it already points inward; a
//     center past a corner is clamped on both axes, each component treated the
//     same way."
//   - `specs/world.md` ("The camera and the view"): the view is "`x` from
//     `player.x - STAGE_CX` to `player.x + STAGE_CX` and `y` from
//     `player.y - STAGE_CY` to `player.y + STAGE_CY`", with `STAGE_CX` (`640`)
//     and `STAGE_CY` (`360`).
//   - `specs/world.md` ("One tick"), phase 6: while `effectMotion` is on "every
//     remaining projectile moves ... and the shards bounce: a projectile's
//     position advances by its velocity times `TICK_DT`".
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed shard is
//     "centered at `(x, y)` with velocity `(vx, vy)`", carries the level-1 row
//     while Shard is not held, and first moves on the next tick;
//     (`setEffectMotion`, on) "Projectiles integrate, lanterns revolve, shards
//     bounce".
//
// Every figure below is read from `../constants`, never from a build.

import {
  SHARD_LEVELS,
  STAGE_CX,
  STAGE_CY,
  TICK_DT,
  INFINITE_PIERCE,
} from "../constants";
import {
  isolate,
  enable,
  present,
  projectileById,
  spawnProjectileAt,
  type Harness,
  type Point,
  type ProjectileSnapshot,
  type WickSnapshot,
} from "../harness";

/** The speed a posed shard flies at in these checks: row 1's `500`. */
export const BOUNCE_SPEED = SHARD_LEVELS[0].speed;

/** How far a shard at {@link BOUNCE_SPEED} moves on one tick: `500 / 60` units. */
export const BOUNCE_STEP = BOUNCE_SPEED * TICK_DT;

/** The four edges of the view on one tick, in world units. */
export interface ViewEdges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The view's edges on `snapshot`: `player.x ± STAGE_CX` and
 * `player.y ± STAGE_CY`, read against the lamplighter's position of that tick,
 * which is the position after it moved.
 */
export function viewEdges(snapshot: WickSnapshot): ViewEdges {
  const { player } = snapshot.run;
  return {
    left: player.x - STAGE_CX,
    right: player.x + STAGE_CX,
    top: player.y - STAGE_CY,
    bottom: player.y + STAGE_CY,
  };
}

/**
 * Reset to an isolated night with `effectMotion` alone turned on, the one
 * faculty the bounce is part of, and answer the night as posed. Nothing is
 * alive, so no shard hits anything; no weapon is held and `weaponFire` is off,
 * so nothing else is fired.
 */
export function isolateForBounce(h: Harness): WickSnapshot {
  const posed = isolate(h);
  enable(h, "effectMotion");
  return posed;
}

/**
 * Pose one shard centered at `at` with velocity `velocity` and infinite pierce,
 * the pierce every shard carries, and answer it as the snapshot reports it.
 */
export function placeShard(
  h: Harness,
  at: Point,
  velocity: Point,
): ProjectileSnapshot {
  const id = spawnProjectileAt(
    h,
    "shard",
    at.x,
    at.y,
    velocity.x,
    velocity.y,
    INFINITE_PIERCE,
  );
  return present(
    projectileById(h.snapshot(), id),
    `the shard posed at ${at.x}, ${at.y}`,
  );
}

/** The shard `id` names on `snapshot`, or the check fails naming `what`. */
export function shardOn(
  snapshot: WickSnapshot,
  id: number,
  what: string,
): ProjectileSnapshot {
  return present(projectileById(snapshot, id), what);
}
