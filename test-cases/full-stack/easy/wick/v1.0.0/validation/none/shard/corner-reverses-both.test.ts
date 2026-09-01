// Wick — shard/corner-reverses-both: a corner reverses both velocity
// components on one tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "After the
// shard's move on a tick, a center past an edge of that rectangle is clamped
// to that edge, and the velocity component across that edge reverses when it
// points outward ...; a center past a corner is clamped on both axes, each
// component treated the same way." The view is "`x` from `player.x - STAGE_CX`
// to `player.x + STAGE_CX` and `y` from `player.y - STAGE_CY` to
// `player.y + STAGE_CY`" (`specs/world.md`), `STAGE_CX` (`640`) and `STAGE_CY`
// (`360`), and a projectile moves by "its velocity times `TICK_DT`" per tick.
// So a shard at `(620, 340)` flying `(500, 500)` from a lamplighter at the
// origin stands at `(636.667, 356.667)` after two ticks, inside on both axes;
// on the third it would reach `(645, 365)`, past the corner on both, so it is
// clamped to `(640, 360)` with velocity `(-500, -500)` on that one tick.
//
// THE POSE. An isolated night with the lamplighter at the origin, one shard
// posed through `spawnProjectile` with infinite pierce, and `effectMotion`
// alone turned on, since the bounce is part of the motion phase it gates.
// Nothing is alive, so nothing is hit. The shard starts the same distance
// inside both edges with the same speed along both axes, so it crosses both
// on the same tick. The second tick is read as well as the third, so a build
// that reverses a component early fails on that.
//
// TOLERANCE. `POSITION_TOL` on each center, a position integrated over at most
// three ticks of `500 / 60`; `FLOAT_TOL` on each velocity component, a sign
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
} from "../harness";
import { BOUNCE_SPEED, BOUNCE_STEP, placeShard, viewEdges } from "./stage";

/** How far inside both edges the shard starts: two ticks short, three past. */
const INSET = 20;

/** The ticks stepped: two short of the corner and the bounce. */
const TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clamps a shard to the view's corner and reverses both vx and vy on the tick it would cross it", async () => {
  const posed = await isolate(h, { on: ["effectMotion"] });
  const edges = viewEdges(posed);
  const shard = await placeShard(
    h,
    { x: edges.right - INSET, y: edges.bottom - INSET },
    { x: BOUNCE_SPEED, y: BOUNCE_SPEED },
  );

  const ticks = await captureReplay(h, "corner", () => h.stepWatching(TICKS));
  assertEqual(ticks.length, TICKS, "ticks stepped");

  const second = mustProjectile(ticks[1]!, shard.id);
  assertNear(
    second.x,
    shard.x + 2 * BOUNCE_STEP,
    POSITION_TOL,
    "x after two ticks, still inside the view",
  );
  assertNear(
    second.y,
    shard.y + 2 * BOUNCE_STEP,
    POSITION_TOL,
    "y after two ticks, still inside the view",
  );
  assertNear(second.vx, BOUNCE_SPEED, FLOAT_TOL, "vx after two ticks");
  assertNear(second.vy, BOUNCE_SPEED, FLOAT_TOL, "vy after two ticks");

  const bounced = mustProjectile(ticks[2]!, shard.id);
  const corner = viewEdges(ticks[2]!);
  assertNear(bounced.x, corner.right, POSITION_TOL, "x on the corner tick");
  assertNear(bounced.y, corner.bottom, POSITION_TOL, "y on the corner tick");
  assertNear(
    bounced.vx,
    -BOUNCE_SPEED,
    FLOAT_TOL,
    "vx on the corner tick, reversed",
  );
  assertNear(
    bounced.vy,
    -BOUNCE_SPEED,
    FLOAT_TOL,
    "vy on the corner tick, reversed",
  );
});
