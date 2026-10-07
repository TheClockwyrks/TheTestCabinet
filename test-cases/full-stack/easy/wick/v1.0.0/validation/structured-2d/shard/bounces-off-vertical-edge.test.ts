// shard/bounces-off-vertical-edge — a shard reaching the view's left or right
// edge is clamped to it and sent back.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "While alive a
// shard stays inside the view: the `STAGE_W × STAGE_H` (`1280 × 720`)
// rectangle centered on the player's center on that tick, after the
// lamplighter has moved. After the shard's move on a tick, a center past an
// edge of that rectangle is clamped to that edge, and the velocity component
// across that edge reverses when it points outward and is left as it is when
// it already points inward." `specs/world.md` ("The camera and the view") puts
// that rectangle's `x` "from `player.x - STAGE_CX` to `player.x + STAGE_CX`",
// with `STAGE_CX` (`640`), so the two vertical edges stand at
// `player.x ± 640`; the lamplighter holds no key here, so both stay where the
// run began. `specs/world.md` ("One tick"), phase 6, moves a projectile by
// "its velocity times `TICK_DT`", so a shard posed `INSET` (10) units inside
// an edge at `SHARD_SPEED` is still inside after one tick and `6.67` units
// past the edge after two.
//
// WHAT IS READ, ON WHICH TICKS. The trace of each shard over three ticks. On
// tick 1 it is one step along, inside the edge, with its velocity unchanged,
// so a build that reverses before the crossing fails. On tick 2 its center
// is exactly on the edge and its `vx` is the negation of the posed one. On
// tick 3 it is one step back inside, so a build that clamps a shard onto the
// edge and leaves it there fails. Each shard's `y` is read on every tick too,
// so a build that reflects the wrong component fails here rather than at the
// horizontal point.
//
// WHY BOTH EDGES IN ONE RUN. The review item is the pair, and the two shards
// are independent: nothing in `specs/weapons.md` has one projectile act on
// another, and each stays within `10` units of its own edge, `1270` from the
// other's. They are posed at different `y` so the replay shows both.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding the two shards
// alone with `effectMotion` the one switch on, so the flight is the only thing
// running: no enemy to hit, no weapon to fire, no director. A posed shard
// takes level 1's `duration` of 3 seconds (`specs/instrumentation.md`,
// `spawnProjectile`), 180 ticks, so both outlive the trace.
//
// THE TOLERANCE. `MOTION_EPS` on each position, a figure the build reaches by
// integrating and clamping, and `REAL_EPS` on each velocity component, an
// exact figure negated. A build that misses the clamp is `6.67` units out and
// climbing.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { MOTION_EPS, REAL_EPS, STAGE_CX } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  type SnapshotProjectile,
} from "../harness";
import {
  BOUNCE_TICK,
  INSET,
  SHARD_SPEED,
  STEP,
  placeShard,
  poseFlight,
  traceShards,
} from "./bouncing";

/** The `y` each shard holds, well inside the view's `± 360`. */
const RIGHT_Y = -100;
const LEFT_Y = 100;

/** Ticks traced: the approach, the bounce, and the tick after it. */
const TICKS = BOUNCE_TICK + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clamps a shard to the view's right and left edge and reverses its vx", async () => {
  const posed = poseFlight(h);
  const { player } = posed.run;
  const right = placeShard(
    h,
    player.x + STAGE_CX - INSET,
    player.y + RIGHT_Y,
    SHARD_SPEED,
    0,
  );
  const left = placeShard(
    h,
    player.x - STAGE_CX + INSET,
    player.y + LEFT_Y,
    -SHARD_SPEED,
    0,
  );

  const [toRight, toLeft] = await captureReplay(h, "side", () =>
    traceShards(h, [right, left], TICKS),
  );

  read(
    toRight,
    "the right-bound shard",
    player.x + STAGE_CX,
    1,
    player.y + RIGHT_Y,
  );
  read(
    toLeft,
    "the left-bound shard",
    player.x - STAGE_CX,
    -1,
    player.y + LEFT_Y,
  );
});

/**
 * `trace` approaches `edge` along `sign`, is clamped onto it on `BOUNCE_TICK`
 * with its `vx` reversed, and is one step back inside on the tick after,
 * holding `y` throughout.
 */
function read(
  trace: readonly SnapshotProjectile[],
  who: string,
  edge: number,
  sign: number,
  y: number,
): void {
  const approach = trace[BOUNCE_TICK - 2];
  assertNear(
    approach.x,
    edge - sign * (INSET - STEP),
    MOTION_EPS,
    `${who}'s x after tick ${BOUNCE_TICK - 1}, one step short of the edge`,
  );
  assertNear(
    approach.vx,
    sign * SHARD_SPEED,
    REAL_EPS,
    `${who}'s vx after tick ${BOUNCE_TICK - 1}, before it reaches the edge`,
  );

  const bounced = trace[BOUNCE_TICK - 1];
  assertNear(
    bounced.x,
    edge,
    MOTION_EPS,
    `${who}'s x after tick ${BOUNCE_TICK}, clamped to the view's edge (specs/weapons.md, Shard)`,
  );
  assertNear(
    bounced.vx,
    -sign * SHARD_SPEED,
    REAL_EPS,
    `${who}'s vx after tick ${BOUNCE_TICK}, the component across the edge reversed`,
  );

  const away = trace[BOUNCE_TICK];
  assertNear(
    away.x,
    edge - sign * STEP,
    MOTION_EPS,
    `${who}'s x after tick ${BOUNCE_TICK + 1}, one step back inside the view`,
  );
  assertNear(
    away.vx,
    -sign * SHARD_SPEED,
    REAL_EPS,
    `${who}'s vx after tick ${BOUNCE_TICK + 1}, still heading inward`,
  );

  for (const [i, shard] of trace.entries()) {
    assertNear(shard.y, y, MOTION_EPS, `${who}'s y after tick ${i + 1}`);
    assertNear(shard.vy, 0, REAL_EPS, `${who}'s vy after tick ${i + 1}`);
  }
}
