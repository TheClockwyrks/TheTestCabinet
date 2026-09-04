// Wick — shard/bounces-off-horizontal-edge: a shard bounces off the view's top
// and bottom edges.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "While alive a shard stays inside the view:
//     the `STAGE_W × STAGE_H` (`1280 × 720`) rectangle centered on the player's
//     center on that tick, after the lamplighter has moved. After the shard's
//     move on a tick, a center past an edge of that rectangle is clamped to
//     that edge, and the velocity component across that edge reverses when it
//     points outward and is left as it is when it already points inward".
//   - `specs/world.md` ("The camera and the view"): the view's `y` runs "from
//     `player.y - STAGE_CY` to `player.y + STAGE_CY`", `STAGE_CY` (`360`).
//   - `specs/world.md` ("One tick"), phase 6: a projectile's "position advances
//     by its velocity times `TICK_DT`" on every tick it moves.
//
// WHAT IS READ. A shard posed 20 units inside the bottom edge and flying `+y`
// at `500`, and its mirror inside the top edge flying `-y`, over four ticks.
// Each moves `500 / 60` a tick, so after two ticks it stands 3.333 units short
// of the edge, still outward; on the third it would reach 5 units past the
// edge, so it reads exactly the edge with its `vy` reversed; on the fourth it
// stands one step back inside. The second tick is read as well as the third, so
// a build whose rectangle stands short of `360`, or that reverses on approach
// rather than on crossing, fails there. The vertical half-extent is `360` and
// not the `640` of the horizontal one, so a build that keeps a shard inside a
// square fails here rather than on the side edges.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with `effectMotion` alone
// turned on, the faculty the bounce belongs to ("shards bounce",
// `specs/instrumentation.md`). Nothing is alive, so nothing is hit, and no
// weapon is held, so nothing else is fired. The lamplighter stands still, so
// the rectangle is the one the pose read. The two shards share `x` and never
// meet, each staying within 5 units of its own edge.
//
// TOLERANCE. `MOTION_TOLERANCE` on each center, a position integrated over at
// most four ticks; `FIGURE_TOLERANCE` on each velocity component, a sign flip
// of a stated figure. The alternatives a build could hold are at least 3.3
// units, or the whole `1000` of a reversal, away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  type ProjectileSnapshot,
  type WickSnapshot,
} from "../harness";
import {
  BOUNCE_SPEED,
  BOUNCE_STEP,
  isolateForBounce,
  placeShard,
  shardOn,
  viewEdges,
} from "./bounce";

/** How far inside its edge each shard starts: two ticks short of it, three past. */
const INSET = 20;

/** The ticks traced: two short of the edge, the crossing, and one coming back. */
const TICKS = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/**
 * `shard`, posed flying at `sign × BOUNCE_SPEED` toward the edge at
 * `player.y + sign × STAGE_CY`, stands short of that edge on tick 2, on it with
 * `vy` reversed on tick 3, and one step back inside on tick 4.
 */
function assertEdgeBounce(
  trace: readonly WickSnapshot[],
  shard: ProjectileSnapshot,
  sign: 1 | -1,
  what: string,
): void {
  const second = shardOn(trace[1], shard.id, `${what} after tick 2`);
  assertWithin(
    second.y,
    shard.y + sign * 2 * BOUNCE_STEP,
    MOTION_TOLERANCE,
    `${what}: y after two ticks, still inside the view`,
  );
  assertWithin(
    second.vy,
    sign * BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `${what}: vy after two ticks, still outward`,
  );

  const bounced = shardOn(trace[2], shard.id, `${what} after tick 3`);
  const edges = viewEdges(trace[2]);
  const edge = sign === 1 ? edges.bottom : edges.top;
  assertWithin(
    bounced.y,
    edge,
    MOTION_TOLERANCE,
    `${what}: y on the crossing tick, clamped to the edge`,
  );
  assertWithin(
    bounced.vy,
    -sign * BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `${what}: vy on the crossing tick, reversed`,
  );

  const back = shardOn(trace[3], shard.id, `${what} after tick 4`);
  assertWithin(
    back.y,
    edge - sign * BOUNCE_STEP,
    MOTION_TOLERANCE,
    `${what}: y one tick after the bounce, coming back`,
  );
  assertWithin(
    back.vy,
    -sign * BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `${what}: vy one tick after the bounce`,
  );
}

it("clamps a shard to player.y ± 360 and reverses its vy on the tick it would cross the top or bottom edge", async () => {
  const posed = isolateForBounce(h);
  const edges = viewEdges(posed);
  const down = placeShard(
    h,
    { x: posed.run.player.x, y: edges.bottom - INSET },
    { x: 0, y: BOUNCE_SPEED },
  );
  const up = placeShard(
    h,
    { x: posed.run.player.x, y: edges.top + INSET },
    { x: 0, y: -BOUNCE_SPEED },
  );

  const trace = await captureReplay(h, "top", () => h.trace(TICKS));
  assertEqual(trace.length, TICKS, "ticks traced");

  assertEdgeBounce(trace, down, 1, "the shard flying down");
  assertEdgeBounce(trace, up, -1, "the shard flying up");
});
