// shard/bounces-off-horizontal-edge — a shard reaching the view's top or
// bottom edge is clamped to it and sent back.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "While alive a
// shard stays inside the view: the `STAGE_W × STAGE_H` (`1280 × 720`)
// rectangle centered on the player's center on that tick, after the
// lamplighter has moved. After the shard's move on a tick, a center past an
// edge of that rectangle is clamped to that edge, and the velocity component
// across that edge reverses when it points outward and is left as it is when
// it already points inward." `specs/world.md` ("The camera and the view") puts
// that rectangle's `y` "from `player.y - STAGE_CY` to `player.y + STAGE_CY`",
// with `STAGE_CY` (`360`), so the two horizontal edges stand at
// `player.y ± 360`; the lamplighter holds no key here, so both stay where the
// run began. `specs/world.md` ("One tick"), phase 6, moves a projectile by
// "its velocity times `TICK_DT`", so a shard posed `INSET` (10) units inside
// an edge at `SHARD_SPEED` is still inside after one tick and `6.67` units
// past the edge after two.
//
// WHAT IS READ, ON WHICH TICKS. The trace of each shard over three ticks. On
// tick 1 it is one step along, inside the edge, with its velocity unchanged,
// so a build that reverses before the crossing fails. On tick 2 its center is
// exactly on the edge and its `vy` is the negation of the posed one. On tick 3
// it is one step back inside, so a build that clamps a shard onto the edge and
// leaves it there fails. Each shard's `x` is read on every tick too, so a
// build that reflects the wrong component fails here rather than at the
// vertical point.
//
// WHY BOTH EDGES IN ONE RUN. The review item is the pair, and the two shards
// are independent: nothing in `specs/weapons.md` has one projectile act on
// another, and each stays within `10` units of its own edge, `710` from the
// other's. They are posed at different `x` so the replay shows both.
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
import { MOTION_EPS, REAL_EPS, STAGE_CY } from "../constants";
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

/** The `x` each shard holds, well inside the view's `± 640`. */
const BOTTOM_X = -100;
const TOP_X = 100;

/** Ticks traced: the approach, the bounce, and the tick after it. */
const TICKS = BOUNCE_TICK + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clamps a shard to the view's bottom and top edge and reverses its vy", async () => {
  const posed = poseFlight(h);
  const { player } = posed.run;
  const down = placeShard(
    h,
    player.x + BOTTOM_X,
    player.y + STAGE_CY - INSET,
    0,
    SHARD_SPEED,
  );
  const up = placeShard(
    h,
    player.x + TOP_X,
    player.y - STAGE_CY + INSET,
    0,
    -SHARD_SPEED,
  );

  const [downward, upward] = await captureReplay(h, "top", () =>
    traceShards(h, [down, up], TICKS),
  );

  read(
    downward,
    "the downward shard",
    player.y + STAGE_CY,
    1,
    player.x + BOTTOM_X,
  );
  read(upward, "the upward shard", player.y - STAGE_CY, -1, player.x + TOP_X);
});

/**
 * `trace` approaches `edge` along `sign`, is clamped onto it on `BOUNCE_TICK`
 * with its `vy` reversed, and is one step back inside on the tick after,
 * holding `x` throughout.
 */
function read(
  trace: readonly SnapshotProjectile[],
  who: string,
  edge: number,
  sign: number,
  x: number,
): void {
  const approach = trace[BOUNCE_TICK - 2];
  assertNear(
    approach.y,
    edge - sign * (INSET - STEP),
    MOTION_EPS,
    `${who}'s y after tick ${BOUNCE_TICK - 1}, one step short of the edge`,
  );
  assertNear(
    approach.vy,
    sign * SHARD_SPEED,
    REAL_EPS,
    `${who}'s vy after tick ${BOUNCE_TICK - 1}, before it reaches the edge`,
  );

  const bounced = trace[BOUNCE_TICK - 1];
  assertNear(
    bounced.y,
    edge,
    MOTION_EPS,
    `${who}'s y after tick ${BOUNCE_TICK}, clamped to the view's edge (specs/weapons.md, Shard)`,
  );
  assertNear(
    bounced.vy,
    -sign * SHARD_SPEED,
    REAL_EPS,
    `${who}'s vy after tick ${BOUNCE_TICK}, the component across the edge reversed`,
  );

  const away = trace[BOUNCE_TICK];
  assertNear(
    away.y,
    edge - sign * STEP,
    MOTION_EPS,
    `${who}'s y after tick ${BOUNCE_TICK + 1}, one step back inside the view`,
  );
  assertNear(
    away.vy,
    -sign * SHARD_SPEED,
    REAL_EPS,
    `${who}'s vy after tick ${BOUNCE_TICK + 1}, still heading inward`,
  );

  for (const [i, shard] of trace.entries()) {
    assertNear(shard.x, x, MOTION_EPS, `${who}'s x after tick ${i + 1}`);
    assertNear(shard.vx, 0, REAL_EPS, `${who}'s vx after tick ${i + 1}`);
  }
}
