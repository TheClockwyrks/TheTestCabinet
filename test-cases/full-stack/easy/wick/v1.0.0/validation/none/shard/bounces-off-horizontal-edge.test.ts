// Wick — shard/bounces-off-horizontal-edge: a shard bounces off the view's top
// and bottom edges.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "While alive a
// shard stays inside the view: the `STAGE_W × STAGE_H` (`1280 × 720`)
// rectangle centered on the player's center on that tick ... After the shard's
// move on a tick, a center past an edge of that rectangle is clamped to that
// edge, and the velocity component across that edge reverses when it points
// outward". `specs/world.md` ("The camera and the view") puts the view's `y`
// "from `player.y - STAGE_CY` to `player.y + STAGE_CY`", `STAGE_CY` (`360`),
// and (phase 6) moves a projectile by "its velocity times `TICK_DT`" on every
// tick it moves. So a shard at `(0, 340)` flying `(0, 500)` from a lamplighter
// at the origin stands at `356.667` after two ticks, still inside; on the third
// it would reach `365`, past `360`, so it is clamped to `360` with velocity
// `(0, -500)`; and on the fourth it is back at `351.667`. A shard at
// `(0, -340)` flying `(0, -500)` does the same against `-360`.
//
// THE POSE. An isolated night with the lamplighter at the origin, the two
// shards posed through `spawnProjectile` with infinite pierce, and
// `effectMotion` alone turned on, since the bounce is part of the motion phase
// it gates ("shards bounce", `specs/instrumentation.md`). Nothing is alive, so
// nothing is hit; `weaponFire` is held so nothing else is fired. A posed shard
// "first moves ... on the next tick", so the first stepped tick is its first
// move. The second tick is read as well as the third, so a build whose edge
// stands short of `360` fails on the clamp it applied early.
//
// TOLERANCE. `POSITION_TOL` on each center, a position integrated over at most
// four ticks of `500 / 60`; `FLOAT_TOL` on each velocity component, a sign
// flip of an exact figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustProjectile,
  type Harness,
  type ProjectileView,
  type WickSnapshot,
} from "../harness";
import { BOUNCE_SPEED, BOUNCE_STEP, placeShard, viewEdges } from "./stage";

/** How far inside the top and bottom edges the shards start: two ticks short, three past. */
const INSET = 20;

/** The ticks stepped: two short of the edge, the bounce, and one back. */
const TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * `shard`, posed flying toward the edge at `player.y + sign × 360`, is short
 * of it on tick 2, clamped to it with its `vy` reversed on tick 3, and one
 * step back on tick 4.
 */
function assertEdgeBounce(
  ticks: readonly WickSnapshot[],
  shard: ProjectileView,
  sign: 1 | -1,
  what: string,
): void {
  const { id } = shard;
  const start = shard.y;
  const second = mustProjectile(ticks[1]!, id);
  assertNear(
    second.y,
    start + sign * 2 * BOUNCE_STEP,
    POSITION_TOL,
    `${what}: y after two ticks, still inside the view`,
  );
  assertNear(
    second.vy,
    sign * BOUNCE_SPEED,
    FLOAT_TOL,
    `${what}: vy after two ticks, still outward`,
  );

  const bounced = mustProjectile(ticks[2]!, id);
  const edges = viewEdges(ticks[2]!);
  const edge = sign === 1 ? edges.bottom : edges.top;
  assertNear(bounced.y, edge, POSITION_TOL, `${what}: y on the bounce tick`);
  assertNear(
    bounced.vy,
    -sign * BOUNCE_SPEED,
    FLOAT_TOL,
    `${what}: vy on the bounce tick, reversed`,
  );

  const back = mustProjectile(ticks[3]!, id);
  assertNear(
    back.y,
    edge - sign * BOUNCE_STEP,
    POSITION_TOL,
    `${what}: y one tick after the bounce, coming back`,
  );
  assertNear(
    back.vy,
    -sign * BOUNCE_SPEED,
    FLOAT_TOL,
    `${what}: vy one tick after the bounce`,
  );
}

it("clamps a shard to player.y ± 360 and reverses its vy on the tick it would cross the top or bottom edge", async () => {
  const posed = await isolate(h, { on: ["effectMotion"] });
  const edges = viewEdges(posed);
  const down = await placeShard(
    h,
    { x: 0, y: edges.bottom - INSET },
    { x: 0, y: BOUNCE_SPEED },
  );
  const up = await placeShard(
    h,
    { x: 0, y: edges.top + INSET },
    { x: 0, y: -BOUNCE_SPEED },
  );

  const ticks = await captureReplay(h, "top", () => h.stepWatching(TICKS));
  assertEqual(ticks.length, TICKS, "ticks stepped");

  assertEdgeBounce(ticks, down, 1, "the shard flying down");
  assertEdgeBounce(ticks, up, -1, "the shard flying up");
});
