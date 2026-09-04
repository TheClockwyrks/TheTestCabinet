// Wick — shard/view-follows-player: the bounce rectangle is centered on the
// player's position of the tick, after the lamplighter has moved.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "While alive a
// shard stays inside the view: the `STAGE_W × STAGE_H` (`1280 × 720`)
// rectangle centered on the player's center on that tick, after the
// lamplighter has moved. After the shard's move on a tick, a center past an
// edge of that rectangle is clamped to that edge, and the velocity component
// across that edge reverses when it points outward". `specs/world.md` ("One
// tick") moves the lamplighter in phase 2 and the projectiles in phase 6, and
// puts the view's right edge at `player.x + STAGE_CX`, `STAGE_CX` (`640`). So
// with the lamplighter walking right, a shard posed on the right edge and
// flying `(500, 0)` crosses it on its first tick and is clamped to
// `player.x + 640` for the `player.x` the same tick's movement left, not the
// `640` the tick began with, with its `vx` reversed to `-500`.
//
// THE POSE. An isolated night with the lamplighter at the origin, one shard
// posed at `(640, 0)` flying `(500, 0)` with infinite pierce, `effectMotion`
// alone turned on, and the `right` action held through a real key for two
// ticks. The lamplighter's own step is read off the tick rather than assumed,
// and must be a positive step shorter than the shard's `500 / 60`, so the
// shard is past the moved edge on its first tick; the edge the shard is
// clamped to is then computed from the position the tick reports. Nothing is
// alive, so nothing is hit, and `weaponFire` is held so nothing else fires.
//
// TOLERANCE. `POSITION_TOL` on the shard's center against the moved edge and
// against one step back from it; `FLOAT_TOL` on `vx`, a sign flip of an exact
// figure. The alternatives, an edge read before the move or a fixed edge, are
// the lamplighter's whole step away.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertNear,
} from "../assert";
import { BINDINGS, FLOAT_TOL, POSITION_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  holdKeysWatching,
  isolate,
  mustProjectile,
  type Harness,
} from "../harness";
import { BOUNCE_SPEED, BOUNCE_STEP, placeShard, viewEdges } from "./stage";

/** The key that walks the lamplighter right: the first binding of `right`. */
const RIGHT_KEY = BINDINGS.right[0]!;

/** The ticks the key is held: the bounce tick and one coming back. */
const TICKS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clamps a shard to player.x + 640 for the player.x the same tick's walk left", async () => {
  const posed = await isolate(h, { on: ["effectMotion"] });
  const startEdges = viewEdges(posed);
  const shard = await placeShard(
    h,
    { x: startEdges.right, y: 0 },
    { x: BOUNCE_SPEED, y: 0 },
  );

  const ticks = await captureReplay(h, "moving", () =>
    holdKeysWatching(h, [RIGHT_KEY], TICKS),
  );
  assertEqual(ticks.length, TICKS, "ticks stepped");

  const first = ticks[0]!;
  const walked = first.run.player.x - posed.run.player.x;
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
  const movedEdge = viewEdges(first).right;
  const bounced = mustProjectile(first, shard.id);
  assertNear(
    bounced.x,
    movedEdge,
    POSITION_TOL,
    "the shard's x on the bounce tick: the right edge after the lamplighter moved",
  );
  assertNear(
    bounced.vx,
    -BOUNCE_SPEED,
    FLOAT_TOL,
    "the shard's vx on the bounce tick, reversed",
  );

  const back = mustProjectile(ticks[1]!, shard.id);
  assertNear(
    back.x,
    movedEdge - BOUNCE_STEP,
    POSITION_TOL,
    "the shard's x one tick after the bounce, coming back",
  );
  assertNear(
    back.vx,
    -BOUNCE_SPEED,
    FLOAT_TOL,
    "the shard's vx one tick after the bounce",
  );
});
