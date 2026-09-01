// Wick — shard/view-follows-player: the bounce rectangle is centered on the
// lamplighter's position of the tick, after the lamplighter has moved.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"): "While alive a shard stays inside the view:
//     the `STAGE_W × STAGE_H` (`1280 × 720`) rectangle centered on the player's
//     center on that tick, after the lamplighter has moved. After the shard's
//     move on a tick, a center past an edge of that rectangle is clamped to
//     that edge, and the velocity component across that edge reverses when it
//     points outward".
//   - `specs/world.md` ("One tick"): the lamplighter moves in phase 2 and the
//     projectiles move and bounce in phase 6, so the rectangle a shard is
//     clamped against on a tick is built on the `player.x` that tick's own
//     movement left; ("The camera and the view") its right edge is
//     `player.x + STAGE_CX`, `STAGE_CX` (`640`).
//   - `specs/world.md` ("Movement"): the lamplighter walks at `moveSpeed`,
//     `MOVE_SPEED` (`180`) with no Bellows held, so it advances `3` units a
//     tick, well inside a shard's `500 / 60`.
//
// WHAT IS READ. With the `right` action held through a real key, a shard posed
// on the right edge and flying `(500, 0)` crosses that edge on the first tick.
// Its clamped `x` is read against the right edge computed from the lamplighter's
// position AFTER that tick's walk, and its `vx` against the reversal; on the
// second tick it is read one step back inside from that same point. The
// lamplighter's step is read off the tick rather than assumed, and asserted
// positive and shorter than the shard's step, so the crossing is real. A build
// that clamps against the rectangle the tick opened with, or against a fixed
// rectangle, leaves the shard the lamplighter's whole step away from the
// reading.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with `effectMotion` alone
// turned on, the faculty the bounce belongs to ("shards bounce",
// `specs/instrumentation.md`). Nothing is alive, so nothing is hit, and no
// weapon is held, so nothing else is fired. The one thing moving besides the
// shard is the lamplighter, driven by the key its own action is bound to, which
// is what makes the rectangle move.
//
// TOLERANCE. `MOTION_TOLERANCE` on each center, a position integrated over two
// ticks; `FIGURE_TOLERANCE` on `vx`, a sign flip of a stated figure. The
// alternative rectangles are `3` units away, three million times the tolerance.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertWithin,
} from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE } from "../constants";
import { captureReplay, createHarness, keysOf, type Harness } from "../harness";
import {
  BOUNCE_SPEED,
  BOUNCE_STEP,
  isolateForBounce,
  placeShard,
  shardOn,
  viewEdges,
} from "./bounce";

/** The key the lamplighter walks right on: the first code bound to `right`. */
const WALK_KEY = keysOf("right")[0];

/** The ticks traced: the crossing tick and one coming back. */
const TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("clamps a shard to player.x + 640 for the player.x the same tick's walk left", async () => {
  const posed = isolateForBounce(h);
  const shard = placeShard(
    h,
    { x: viewEdges(posed).right, y: posed.run.player.y },
    { x: BOUNCE_SPEED, y: 0 },
  );

  const trace = await captureReplay(h, "moving", async () => {
    h.holdKey(WALK_KEY);
    try {
      return await h.trace(TICKS);
    } finally {
      h.releaseKey(WALK_KEY);
    }
  });
  assertEqual(trace.length, TICKS, "ticks traced");

  const walked = trace[0].run.player.x - posed.run.player.x;
  assertGreaterThan(
    walked,
    0,
    "the lamplighter's step right on the first tick",
  );
  assertLessThan(
    walked,
    BOUNCE_STEP,
    "the lamplighter's step, shorter than the shard's so the shard crosses the moved edge",
  );

  const movedEdge = viewEdges(trace[0]).right;
  const bounced = shardOn(trace[0], shard.id, "the shard after tick 1");
  assertWithin(
    bounced.x,
    movedEdge,
    MOTION_TOLERANCE,
    "the shard's x on the crossing tick: the right edge after the lamplighter moved",
  );
  assertWithin(
    bounced.vx,
    -BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    "the shard's vx on the crossing tick, reversed",
  );

  const back = shardOn(trace[1], shard.id, "the shard after tick 2");
  assertWithin(
    back.x,
    movedEdge - BOUNCE_STEP,
    MOTION_TOLERANCE,
    "the shard's x one tick after the bounce, coming back",
  );
  assertWithin(
    back.vx,
    -BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    "the shard's vx one tick after the bounce",
  );
});
