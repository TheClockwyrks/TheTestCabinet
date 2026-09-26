// shard/bouncing — a posed shard in flight, shared by the bounce checks in
// this directory. CASE-PROVIDED.
//
// WHAT THE BOUNCE CHECKS SHARE. `specs/weapons.md` ("Shard"): "While alive a
// shard stays inside the view: the `STAGE_W × STAGE_H` (`1280 × 720`)
// rectangle centered on the player's center on that tick, after the
// lamplighter has moved. After the shard's move on a tick, a center past an
// edge of that rectangle is clamped to that edge, and the velocity component
// across that edge reverses when it points outward". Every check on that rule
// poses a shard a few units inside an edge, heading out at `500` units per
// second, turns `effectMotion` on so "the shards bounce" (`specs/world.md`,
// phase 6), and reads the shard tick by tick. The arrangement is spelled once
// here and decides nothing: the shard is placed through `spawnProjectile`,
// with `INFINITE_PIERCE` as a fired shard carries, and the real ticks move it.
//
// WHY A POSED SHARD AND NOT A FIRED ONE. A fired shard leaves the player's
// center and needs `640 / 500` seconds to reach an edge; a posed one is
// placed where the bounce is a tick or two away, so the trace a check reads
// is short and the tick of the bounce is decided by arithmetic alone.
// `specs/instrumentation.md`: a posed projectile "first moves ... on the next
// tick, exactly as one a tick created".
//
// THE STEP. `500 × TICK_DT` is `8.333…` units a tick, so a shard posed `10`
// units inside an edge is still inside after one tick and past the edge after
// two, which is the tick the bounce lands on.

import { INFINITE_PIERCE, SHARD_LEVELS, TICK_DT } from "../constants";
import {
  advanceTicks,
  enable,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
  type SnapshotProjectile,
  type WickSnapshot,
} from "../harness";

/** The speed a posed shard flies at: level 1's `speed`, 500. */
export const SHARD_SPEED = SHARD_LEVELS[0].speed;

/** How far a shard at `SHARD_SPEED` moves in one tick: `500 × TICK_DT`. */
export const STEP = SHARD_SPEED * TICK_DT;

/**
 * How far inside an edge a shard is posed: one step keeps it inside, two put
 * it past the edge, so the bounce lands on tick 2 of the trace.
 */
export const INSET = 10;

/** The tick of the trace a shard posed `INSET` inside an edge bounces on. */
export const BOUNCE_TICK = 2;

/**
 * Pose an isolated run with `effectMotion` on and nothing else running, and
 * read the lamplighter's center, which every edge is measured from.
 */
export function poseFlight(h: Harness): WickSnapshot {
  isolate(h);
  enable(h, "effectMotion");
  return h.snapshot();
}

/** Place one shard at `(x, y)` flying at `(vx, vy)`, answering its id. */
export function placeShard(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  return placeProjectile(h, "shard", x, y, vx, vy, INFINITE_PIERCE);
}

/**
 * Run `ticks` ticks one at a time and read shard `id` after each. Entry `i`
 * is the shard after tick `i + 1`; a shard that is gone fails the check that
 * reads it, since a posed shard's `ttl` of `3` outlives any trace here.
 */
export async function traceShard(
  h: Harness,
  id: number,
  ticks: number,
): Promise<SnapshotProjectile[]> {
  const trace: SnapshotProjectile[] = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    const s = await advanceTicks(h, 1);
    const shard = projectileById(s, id);
    if (shard === undefined) {
      throw new Error(
        `Expected: the posed shard still in the world after tick ${tick} (specs/weapons.md, Shard)\nActual: gone`,
      );
    }
    trace.push(shard);
  }
  return trace;
}

/** Run `ticks` ticks one at a time and read every listed shard after each. */
export async function traceShards(
  h: Harness,
  ids: readonly number[],
  ticks: number,
): Promise<SnapshotProjectile[][]> {
  const traces: SnapshotProjectile[][] = ids.map(() => []);
  for (let tick = 1; tick <= ticks; tick += 1) {
    const s = await advanceTicks(h, 1);
    ids.forEach((id, i) => {
      const shard = projectileById(s, id);
      if (shard === undefined) {
        throw new Error(
          `Expected: posed shard ${id} still in the world after tick ${tick} (specs/weapons.md, Shard)\nActual: gone`,
        );
      }
      traces[i].push(shard);
    });
  }
  return traces;
}
