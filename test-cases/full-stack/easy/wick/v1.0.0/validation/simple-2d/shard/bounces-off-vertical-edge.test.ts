// Wick — shard/bounces-off-vertical-edge: a shard bounces off the view's left
// and right edges.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "While alive a shard stays inside the view:
//     the `STAGE_W × STAGE_H` (`1280 × 720`) rectangle centered on the player's
//     center on that tick, after the lamplighter has moved. After the shard's
//     move on a tick, a center past an edge of that rectangle is clamped to
//     that edge, and the velocity component across that edge reverses when it
//     points outward and is left as it is when it already points inward".
//   - `specs/world.md` ("The camera and the view"): the view's `x` runs "from
//     `player.x - STAGE_CX` to `player.x + STAGE_CX`", `STAGE_CX` (`640`).
//   - `specs/world.md` ("One tick"), phase 6: a projectile's "position advances
//     by its velocity times `TICK_DT`" on every tick it moves.
//
// WHAT IS READ. A shard posed 20 units inside the right edge and flying `+x` at
// `500`, and its mirror inside the left edge flying `-x`, over four ticks. Each
// moves `500 / 60` a tick, so after two ticks it stands 3.333 units short of
// the edge, still outward; on the third it would reach 5 units past the edge,
// so it reads exactly the edge with its `vx` reversed; on the fourth it stands
// one step back inside. The second tick is read as well as the third, so a
// build whose rectangle stands short of `640`, or that reverses on approach
// rather than on crossing, fails there. Both edges are read in one direction
// each, since the requirement is the pair of vertical edges.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with `effectMotion` alone
// turned on, the faculty the bounce belongs to ("shards bounce",
// `specs/instrumentation.md`). Nothing is alive, so nothing is hit, and no
// weapon is held, so nothing else is fired. The lamplighter stands still, so
// the rectangle is the one the pose read. The two shards share `y` `0` and
// never meet, each staying within 5 units of its own edge.
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
 * `player.x + sign × STAGE_CX`, stands short of that edge on tick 2, on it with
 * `vx` reversed on tick 3, and one step back inside on tick 4.
 */
function assertSideBounce(
  trace: readonly WickSnapshot[],
  shard: ProjectileSnapshot,
  sign: 1 | -1,
  what: string,
): void {
  const second = shardOn(trace[1], shard.id, `${what} after tick 2`);
  assertWithin(
    second.x,
    shard.x + sign * 2 * BOUNCE_STEP,
    MOTION_TOLERANCE,
    `${what}: x after two ticks, still inside the view`,
  );
  assertWithin(
    second.vx,
    sign * BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `${what}: vx after two ticks, still outward`,
  );

  const bounced = shardOn(trace[2], shard.id, `${what} after tick 3`);
  const edges = viewEdges(trace[2]);
  const edge = sign === 1 ? edges.right : edges.left;
  assertWithin(
    bounced.x,
    edge,
    MOTION_TOLERANCE,
    `${what}: x on the crossing tick, clamped to the edge`,
  );
  assertWithin(
    bounced.vx,
    -sign * BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `${what}: vx on the crossing tick, reversed`,
  );

  const back = shardOn(trace[3], shard.id, `${what} after tick 4`);
  assertWithin(
    back.x,
    edge - sign * BOUNCE_STEP,
    MOTION_TOLERANCE,
    `${what}: x one tick after the bounce, coming back`,
  );
  assertWithin(
    back.vx,
    -sign * BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `${what}: vx one tick after the bounce`,
  );
}

it("clamps a shard to player.x ± 640 and reverses its vx on the tick it would cross a side edge", async () => {
  const posed = isolateForBounce(h);
  const edges = viewEdges(posed);
  const right = placeShard(
    h,
    { x: edges.right - INSET, y: posed.run.player.y },
    { x: BOUNCE_SPEED, y: 0 },
  );
  const left = placeShard(
    h,
    { x: edges.left + INSET, y: posed.run.player.y },
    { x: -BOUNCE_SPEED, y: 0 },
  );

  const trace = await captureReplay(h, "side", () => h.trace(TICKS));
  assertEqual(trace.length, TICKS, "ticks traced");

  assertSideBounce(trace, right, 1, "the shard flying right");
  assertSideBounce(trace, left, -1, "the shard flying left");
});
