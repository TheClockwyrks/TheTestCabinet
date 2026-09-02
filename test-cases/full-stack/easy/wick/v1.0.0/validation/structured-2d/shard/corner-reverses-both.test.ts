// shard/corner-reverses-both — a shard that crosses a corner of the view on
// one tick is clamped on both axes and has both velocity components reversed.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "a center past
// a corner is clamped on both axes, each component treated the same way",
// where the same way is "a center past an edge of that rectangle is clamped to
// that edge, and the velocity component across that edge reverses when it
// points outward". `specs/world.md` ("The camera and the view") makes the
// rectangle `x` from `player.x - STAGE_CX` to `player.x + STAGE_CX` and `y`
// from `player.y - STAGE_CY` to `player.y + STAGE_CY`, `STAGE_CX` (`640`) and
// `STAGE_CY` (`360`), so its bottom-right corner is
// `(player.x + 640, player.y + 360)`; the lamplighter holds no key here, so it
// stays where the run began.
//
// WHY THE SHARD CROSSES BOTH EDGES ON ONE TICK. It is posed `INSET` (10) units
// inside each edge with `SHARD_SPEED` along each axis, so each component
// advances by the same `STEP` on every tick (`specs/world.md`, One tick, phase
// 6): after one tick it is `1.67` inside both edges, and after two it is
// `6.67` past both at once, which is the case the corner rule names.
//
// WHAT IS READ, ON WHICH TICKS. Tick 1: both components one step along, both
// still inside, so a build that reverses early fails. Tick 2: the center on
// the corner and both components negated. Tick 3: one step back inside on both
// axes. A build that treats a corner as one edge — reversing one component and
// letting the other carry the shard out of the view — fails on the component
// it left alone, and one that clamps both without reversing both fails on the
// velocity.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding the one shard with
// `effectMotion` the one switch on, so the flight is the only thing running:
// no enemy to hit, no weapon to fire, no director. A posed shard takes level
// 1's `duration` of 3 seconds (`specs/instrumentation.md`, `spawnProjectile`),
// 180 ticks, so it outlives the trace.
//
// THE TOLERANCE. `MOTION_EPS` on each position, a figure the build reaches by
// integrating and clamping, and `REAL_EPS` on each velocity component, an
// exact figure negated.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, REAL_EPS, STAGE_CX, STAGE_CY } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  BOUNCE_TICK,
  INSET,
  SHARD_SPEED,
  STEP,
  placeShard,
  poseFlight,
  traceShard,
} from "./bouncing";

/** Ticks traced: the approach, the corner, and the tick after it. */
const TICKS = BOUNCE_TICK + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clamps a shard to the view's bottom-right corner and reverses both components", async () => {
  const posed = poseFlight(h);
  const { player } = posed.run;
  const corner = { x: player.x + STAGE_CX, y: player.y + STAGE_CY };
  const id = placeShard(
    h,
    corner.x - INSET,
    corner.y - INSET,
    SHARD_SPEED,
    SHARD_SPEED,
  );

  const trace = await captureReplay(h, "corner", () =>
    traceShard(h, id, TICKS),
  );

  const approach = trace[BOUNCE_TICK - 2];
  assertNear(
    approach.x,
    corner.x - (INSET - STEP),
    MOTION_EPS,
    `x after tick ${BOUNCE_TICK - 1}, one step short of the corner`,
  );
  assertNear(
    approach.y,
    corner.y - (INSET - STEP),
    MOTION_EPS,
    `y after tick ${BOUNCE_TICK - 1}, one step short of the corner`,
  );
  assertNear(
    approach.vx,
    SHARD_SPEED,
    REAL_EPS,
    `vx after tick ${BOUNCE_TICK - 1}, before the corner`,
  );
  assertNear(
    approach.vy,
    SHARD_SPEED,
    REAL_EPS,
    `vy after tick ${BOUNCE_TICK - 1}, before the corner`,
  );

  const bounced = trace[BOUNCE_TICK - 1];
  assertNear(
    bounced.x,
    corner.x,
    MOTION_EPS,
    `x after tick ${BOUNCE_TICK}, clamped to the corner (specs/weapons.md, Shard)`,
  );
  assertNear(
    bounced.y,
    corner.y,
    MOTION_EPS,
    `y after tick ${BOUNCE_TICK}, clamped to the corner (specs/weapons.md, Shard)`,
  );
  assertNear(
    bounced.vx,
    -SHARD_SPEED,
    REAL_EPS,
    `vx after tick ${BOUNCE_TICK}, reversed at the corner`,
  );
  assertNear(
    bounced.vy,
    -SHARD_SPEED,
    REAL_EPS,
    `vy after tick ${BOUNCE_TICK}, reversed at the corner`,
  );

  const away = trace[BOUNCE_TICK];
  assertNear(
    away.x,
    corner.x - STEP,
    MOTION_EPS,
    `x after tick ${BOUNCE_TICK + 1}, one step back inside the view`,
  );
  assertNear(
    away.y,
    corner.y - STEP,
    MOTION_EPS,
    `y after tick ${BOUNCE_TICK + 1}, one step back inside the view`,
  );
});
