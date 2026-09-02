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
// WHAT IS READ. With the `right` action held through a real key, a shard is
// posed INSIDE the right edge and flies `(500, 0)`, gaining `500 / 60 − 3` on
// the walking edge each tick, so it crosses several ticks in and the camera has
// had ticks to go stale before the reading. The trace is searched for the first
// tick whose `vx` reversed; that tick's clamped `x` is read against the right
// edge computed from the lamplighter's position AFTER that same tick's walk,
// and the tick after it is read one step back inside from that point. The tick
// before the crossing is read strictly inside its own tick's edge with its
// velocity unchanged, so the crossing is the one the reading names.
//
// WHY THE SHARD STARTS INSIDE THE EDGE. Posed ON the edge, the crossing happens
// on the FIRST traced tick, where the rectangle of the previous tick and the
// rectangle of this one are the same picture: the lamplighter has taken one
// step, and a build clamping against the camera it opened the tick with is
// indistinguishable from a build clamping against the camera the walk left. The
// shard is posed `INSET` inside instead, `2.5` times the ground it gains on the
// edge each tick, so a conformant build bounces on the third tick and a build
// one tick behind bounces on the second, against an edge `3` units short.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with `effectMotion` alone
// turned on, the faculty the bounce belongs to ("shards bounce",
// `specs/instrumentation.md`). Nothing is alive, so nothing is hit, and no
// weapon is held, so nothing else is fired. The one thing moving besides the
// shard is the lamplighter, driven by the key its own action is bound to, which
// is what makes the rectangle move.
//
// TOLERANCE. `MOTION_TOLERANCE` on each center, a position integrated over
// several ticks; `FIGURE_TOLERANCE` on `vx`, a sign flip of a stated figure.
// The alternative rectangles are `3` units away, three million times the
// tolerance. The lamplighter's step is read off the trace rather than assumed,
// and only bounded below by `0` and above by the shard's step, so the figure
// itself belongs to the movement points and a build that walks at another speed
// still fails this point only if its rectangle lags.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertWithin,
  fail,
} from "../assert";
import {
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  MOVE_SPEED,
  TICK_DT,
} from "../constants";
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

/** How far the lamplighter advances on one tick: `MOVE_SPEED × TICK_DT`, `3`. */
const WALK_STEP = MOVE_SPEED * TICK_DT;

/** The ground a shard gains on the walking right edge each tick. */
const GAIN_PER_TICK = BOUNCE_STEP - WALK_STEP;

/**
 * How far inside the right edge the shard is posed: two and a half ticks'
 * worth of the ground it gains, so a conformant build crosses on the third
 * tick and a build clamping against the previous tick's camera on the second.
 */
const INSET = 2.5 * GAIN_PER_TICK;

/** The ticks traced: enough for the crossing and one coming back. */
const TICKS = 5;

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
    { x: viewEdges(posed).right - INSET, y: posed.run.player.y },
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

  const crossing = trace.findIndex(
    (frame, index) =>
      shardOn(frame, shard.id, `the shard after tick ${index + 1}`).vx < 0,
  );
  if (crossing < 0) {
    fail(
      `the shard's vx reversed within ${TICKS} ticks, the crossing this point reads`,
      trace.map((frame) => shardOn(frame, shard.id, "the shard").vx),
    );
  }
  assertGreaterThan(
    crossing,
    0,
    "the index of the crossing tick, past the first so the camera has moved since the pose",
  );

  const before = shardOn(
    trace[crossing - 1],
    shard.id,
    `the shard after tick ${crossing}`,
  );
  assertLessThan(
    before.x,
    viewEdges(trace[crossing - 1]).right,
    `the shard's x on tick ${crossing}, still inside that tick's right edge`,
  );
  assertWithin(
    before.vx,
    BOUNCE_SPEED,
    FIGURE_TOLERANCE,
    `the shard's vx on tick ${crossing}, before the crossing`,
  );

  const movedEdge = viewEdges(trace[crossing]).right;
  const bounced = shardOn(
    trace[crossing],
    shard.id,
    `the shard after tick ${crossing + 1}`,
  );
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

  const back = shardOn(
    trace[crossing + 1],
    shard.id,
    `the shard after tick ${crossing + 2}`,
  );
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
