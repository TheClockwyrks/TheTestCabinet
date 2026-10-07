// shard/view-follows-player — the rectangle a shard bounces inside is centred
// on the lamplighter's position of the tick, not on a fixed point.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): the rectangle
// is "centered on the player's center on that tick, after the lamplighter has
// moved", and "After the shard's move on a tick, a center past an edge of that
// rectangle is clamped to that edge". `specs/world.md` ("The camera and the
// view") makes the right edge `player.x + STAGE_CX`, `STAGE_CX` (`640`),
// "recomputed every tick as the lamplighter moves". `specs/world.md` ("One
// tick") puts the lamplighter's move in phase 2 and the shards' bounce in
// phase 6, so the position the rectangle is centred on is the one phase 2 left
// on that same tick. `specs/world.md` ("Movement"): with `right` held the
// direction is `(1, 0)` and "each tick the position advances by the velocity
// times `TICK_DT`", at a `moveSpeed` of `MOVE_SPEED` (`180`) with no Bellows
// held.
//
// WHY THE LAMPLIGHTER IS DRIVEN BY A KEY. The requirement is that the
// rectangle follows the lamplighter's motion WITHIN a tick, so that motion is
// the subject of the point rather than surface on the way to it. No pose can
// stand in for it: `setPlayerPosition` moves nothing during a tick, so a build
// reading a stale position would pass against it.
//
// WHAT IS READ. The shard is posed `START` (4) units right of the lamplighter
// and closes on the right edge at `500 − 180`, 320 units a second, so it
// cannot reach the edge before `636 / 320` seconds — `119.25` ticks — by which
// time the lamplighter has walked over 357 units. The check drives a tick at a
// time until the shard's `vx` turns negative and reads that tick: the shard's
// `x` against `player.x + STAGE_CX` of that same tick, and the lamplighter's
// own walk against a floor of `WALK_FLOOR`. A build whose rectangle is fixed
// where the run began bounces the shard near 640 while the edge stands past
// 990, and one that centres on the lamplighter's position from before the
// tick's move bounces it 3 units short; both fail.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding the one shard with
// `effectMotion` the one switch on, so nothing but the flight and the walk
// happens: no enemy to hit, no weapon to fire, no director. A posed shard
// takes level 1's `duration` of 3 seconds (`specs/instrumentation.md`,
// `spawnProjectile`), 180 ticks, so it is alive across the whole sweep and the
// extra ticks the replay runs after it.
//
// THE TOLERANCE. `MOTION_EPS` on the clamped position against the edge, both
// figures the build reaches by integrating, and `REAL_EPS` on the reversed
// velocity, an exact figure negated. `WALK_FLOOR` is a bound rather than a
// figure: it stands well below the 357 units the closing rate fixes and far
// above the nothing a rectangle fixed at the origin would show.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, fail } from "../assert";
import { BINDINGS, MOTION_EPS, REAL_EPS, STAGE_CX } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  projectileById,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { SHARD_SPEED, placeShard, poseFlight } from "./bouncing";

/** The key that carries the `right` action (`specs/controls.md`). */
const RIGHT_KEY = BINDINGS.right[0];

/** How far right of the lamplighter the shard is posed. */
const START = 4;

/** How long the sweep may run: `636 / 320` seconds is `119.25` ticks. */
const MAX_TICKS = 150;

/**
 * The least distance the lamplighter must have walked by the bouncing tick.
 * The shard closes on the edge at `500 − 180` units a second from 636 units
 * short, so the bounce cannot come before `1.9875` seconds, by which time the
 * walk is over 357 units.
 */
const WALK_FLOOR = 300;

/** Ticks run after the reading, for the replay alone. */
const AFTER_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("bounces the shard at the walking lamplighter's own right edge", async () => {
  const posed = poseFlight(h);
  const start = { x: posed.run.player.x, y: posed.run.player.y };
  const id = placeShard(h, start.x + START, start.y, SHARD_SPEED, 0);

  let bounced: WickSnapshot | undefined;
  h.holdKey(RIGHT_KEY);
  try {
    await captureReplay(h, "moving", async () => {
      for (
        let tick = 1;
        tick <= MAX_TICKS && bounced === undefined;
        tick += 1
      ) {
        const s = await advanceTicks(h, 1);
        const shard = projectileById(s, id);
        if (shard === undefined) {
          fail(
            `the posed shard still in the world after tick ${tick} (specs/weapons.md, Shard)`,
            "gone",
          );
        }
        if (shard.vx < 0) bounced = s;
      }
      await advanceTicks(h, AFTER_TICKS);
    });
  } finally {
    h.releaseKey(RIGHT_KEY);
  }

  if (bounced === undefined) {
    fail(
      `the shard's vx turned negative within ${MAX_TICKS} ticks (specs/weapons.md, Shard)`,
      "it never bounced",
    );
  }
  const shard = projectileById(bounced, id);
  if (shard === undefined) {
    fail("the shard still in the world on the tick it bounced", "gone");
  }

  assertGreaterThan(
    bounced.run.player.x - start.x,
    WALK_FLOOR,
    "the units the lamplighter walked by the tick the shard bounced (specs/world.md, Movement)",
  );
  assertNear(
    shard.x,
    bounced.run.player.x + STAGE_CX,
    MOTION_EPS,
    "the shard's x against the view's right edge on the tick it bounced (specs/weapons.md, Shard)",
  );
  assertNear(
    shard.vx,
    -SHARD_SPEED,
    REAL_EPS,
    "the shard's vx after the bounce",
  );
  assertNear(shard.y, start.y, MOTION_EPS, "the shard's y, which never moved");
  assertNear(
    bounced.run.player.y,
    start.y,
    MOTION_EPS,
    "the lamplighter's y, which never moved",
  );
});
