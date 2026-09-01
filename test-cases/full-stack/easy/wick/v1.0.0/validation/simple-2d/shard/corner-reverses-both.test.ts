// Wick — shard/corner-reverses-both: a shard that crosses the view's corner has
// both velocity components reversed on that one tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "After the shard's move on a tick, a center
//     past an edge of that rectangle is clamped to that edge, and the velocity
//     component across that edge reverses when it points outward ...; a center
//     past a corner is clamped on both axes, each component treated the same
//     way."
//   - `specs/world.md` ("The camera and the view"): the view is "`x` from
//     `player.x - STAGE_CX` to `player.x + STAGE_CX` and `y` from
//     `player.y - STAGE_CY` to `player.y + STAGE_CY`", `STAGE_CX` (`640`) and
//     `STAGE_CY` (`360`).
//   - `specs/world.md` ("One tick"), phase 6: a projectile's "position advances
//     by its velocity times `TICK_DT`" on every tick it moves.
//
// WHAT IS READ. One shard posed 20 units inside both the right and the bottom
// edge, flying `(500, 500)`, over three ticks. It steps `500 / 60` on each axis
// a tick, so after two ticks it stands 3.333 units short of both edges with
// both components still outward; on the third it would reach 5 units past both,
// so it reads the corner exactly, `(player.x + 640, player.y + 360)`, with
// `(-500, -500)`. Both components are read on the same tick, so a build that
// clamps one axis and carries the shard out past the other, or that reverses
// only the axis it crossed first, fails.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with `effectMotion` alone
// turned on, the faculty the bounce belongs to ("shards bounce",
// `specs/instrumentation.md`). Nothing is alive, so nothing is hit, and no
// weapon is held, so nothing else is fired. The lamplighter stands still, so
// the rectangle is the one the pose read. The shard starts the same distance
// inside both edges and moves at the same speed on both axes, so it crosses
// both on the same tick and no other tick decides the reading.
//
// TOLERANCE. `MOTION_TOLERANCE` on each center, a position integrated over at
// most three ticks; `FIGURE_TOLERANCE` on each velocity component, a sign flip
// of a stated figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  BOUNCE_SPEED,
  BOUNCE_STEP,
  isolateForBounce,
  placeShard,
  shardOn,
  viewEdges,
} from "./bounce";

/** How far inside both edges the shard starts: two ticks short of them, three past. */
const INSET = 20;

/** The ticks traced: two short of the corner and the crossing. */
const TICKS = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clamps a shard to the view's corner and reverses both vx and vy on the tick it would cross it", async () => {
  const posed = isolateForBounce(h);
  const edges = viewEdges(posed);
  const shard = placeShard(
    h,
    { x: edges.right - INSET, y: edges.bottom - INSET },
    { x: BOUNCE_SPEED, y: BOUNCE_SPEED },
  );

  const trace = await captureReplay(h, "corner", () => h.trace(TICKS));
  assertEqual(trace.length, TICKS, "ticks traced");

  const second = shardOn(trace[1], shard.id, "the shard after tick 2");
  assertWithin(
    second.x,
    shard.x + 2 * BOUNCE_STEP,
    MOTION_TOLERANCE,
    "x after two ticks, still inside the view",
  );
  assertWithin(
    second.y,
    shard.y + 2 * BOUNCE_STEP,
    MOTION_TOLERANCE,
    "y after two ticks, still inside the view",
  );
  assertWithin(
    second.vx,
    BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    "vx after two ticks, still outward",
  );
  assertWithin(
    second.vy,
    BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    "vy after two ticks, still outward",
  );

  const bounced = shardOn(trace[2], shard.id, "the shard after tick 3");
  const corner = viewEdges(trace[2]);
  assertWithin(
    bounced.x,
    corner.right,
    MOTION_TOLERANCE,
    "x on the crossing tick, clamped to the right edge",
  );
  assertWithin(
    bounced.y,
    corner.bottom,
    MOTION_TOLERANCE,
    "y on the crossing tick, clamped to the bottom edge",
  );
  assertWithin(
    bounced.vx,
    -BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    "vx on the crossing tick, reversed",
  );
  assertWithin(
    bounced.vy,
    -BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    "vy on the crossing tick, reversed",
  );
});
