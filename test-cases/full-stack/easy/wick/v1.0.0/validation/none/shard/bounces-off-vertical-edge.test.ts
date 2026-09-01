// Wick — shard/bounces-off-vertical-edge: a shard bounces off the view's left
// and right edges.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "While alive a
// shard stays inside the view: the `STAGE_W × STAGE_H` (`1280 × 720`)
// rectangle centered on the player's center on that tick ... After the shard's
// move on a tick, a center past an edge of that rectangle is clamped to that
// edge, and the velocity component across that edge reverses when it points
// outward". `specs/world.md` ("The camera and the view") puts the view's `x`
// "from `player.x - STAGE_CX` to `player.x + STAGE_CX`", `STAGE_CX` (`640`),
// and (phase 6) moves a projectile by "its velocity times `TICK_DT`" on every
// tick it moves. So a shard at `(620, 0)` flying `(500, 0)` from a lamplighter
// at the origin stands at `636.667` after two ticks, still inside; on the third
// it would reach `645`, past `640`, so it is clamped to `640` with velocity
// `(-500, 0)`; and on the fourth it is back at `631.667`. A shard at
// `(-620, 0)` flying `(-500, 0)` does the same against `-640`.
//
// THE POSE. An isolated night with the lamplighter at the origin, the two
// shards posed through `spawnProjectile` with infinite pierce, and
// `effectMotion` alone turned on, since the bounce is part of the motion phase
// it gates ("shards bounce", `specs/instrumentation.md`). Nothing is alive, so
// nothing is hit; `weaponFire` is held so nothing else is fired. A posed shard
// "first moves ... on the next tick", so the first stepped tick is its first
// move. The second tick is read as well as the third, so a build whose edge
// stands short of `640` fails on the clamp it applied early.
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

/** How far inside each side edge the shards start: two ticks short of it, three past it. */
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
 * `shard`, posed flying toward the edge at `player.x + sign × 640`, is short
 * of it on tick 2, clamped to it with its `vx` reversed on tick 3, and one
 * step back on tick 4.
 */
function assertSideBounce(
  ticks: readonly WickSnapshot[],
  shard: ProjectileView,
  sign: 1 | -1,
  what: string,
): void {
  const { id } = shard;
  const start = shard.x;
  const second = mustProjectile(ticks[1]!, id);
  assertNear(
    second.x,
    start + sign * 2 * BOUNCE_STEP,
    POSITION_TOL,
    `${what}: x after two ticks, still inside the view`,
  );
  assertNear(
    second.vx,
    sign * BOUNCE_SPEED,
    FLOAT_TOL,
    `${what}: vx after two ticks, still outward`,
  );

  const bounced = mustProjectile(ticks[2]!, id);
  const edges = viewEdges(ticks[2]!);
  const edge = sign === 1 ? edges.right : edges.left;
  assertNear(bounced.x, edge, POSITION_TOL, `${what}: x on the bounce tick`);
  assertNear(
    bounced.vx,
    -sign * BOUNCE_SPEED,
    FLOAT_TOL,
    `${what}: vx on the bounce tick, reversed`,
  );

  const back = mustProjectile(ticks[3]!, id);
  assertNear(
    back.x,
    edge - sign * BOUNCE_STEP,
    POSITION_TOL,
    `${what}: x one tick after the bounce, coming back`,
  );
  assertNear(
    back.vx,
    -sign * BOUNCE_SPEED,
    FLOAT_TOL,
    `${what}: vx one tick after the bounce`,
  );
}

it("clamps a shard to player.x ± 640 and reverses its vx on the tick it would cross a side edge", async () => {
  const posed = await isolate(h, { on: ["effectMotion"] });
  const edges = viewEdges(posed);
  const right = await placeShard(
    h,
    { x: edges.right - INSET, y: 0 },
    { x: BOUNCE_SPEED, y: 0 },
  );
  const left = await placeShard(
    h,
    { x: edges.left + INSET, y: 0 },
    { x: -BOUNCE_SPEED, y: 0 },
  );

  const ticks = await captureReplay(h, "side", () => h.stepWatching(TICKS));
  assertEqual(ticks.length, TICKS, "ticks stepped");

  assertSideBounce(ticks, right, 1, "the shard flying right");
  assertSideBounce(ticks, left, -1, "the shard flying left");
});
