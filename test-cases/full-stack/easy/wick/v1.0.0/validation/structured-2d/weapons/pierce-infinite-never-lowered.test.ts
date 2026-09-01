// weapons/pierce-infinite-never-lowered — infinite pierce is never lowered or
// spent.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "A projectile
// whose `pierce` is `INFINITE_PIERCE` (`-1`) is never lowered and never removed
// by a hit." and "A projectile's `ttl` is set to its `duration` when it is
// fired, and it is removed on the tick `ttl` is due, whether or not it hit
// anything." So a shard posed with pierce `-1` over three moths hits all three
// on its first tick, still reads `-1`, and stays in `projectiles` until its
// `ttl` is due: the level-1 row's duration `3.0`, due `round(3.0 × 60)` = `180`
// ticks after the pose (`specs/world.md`, Timers), so it is present on tick
// `179`.
//
// THE POSE. Three moths at `(188, 0)`, `(200, 0)`, and `(212, 0)`, and a shard
// posed at `(200, 0)` with zero velocity and pierce `-1`: each moth's center is
// within the `8 + 10` overlap bound, a posed projectile "first hits ... on the
// next tick" (`specs/instrumentation.md`), and a shard's level-1 damage `8`
// kills a `5` hp moth, which is how the three hits are read. `effectMotion` is
// held so the shard neither moves nor bounces, while "`ttl` and every re-hit
// entry still count, and hits still resolve"; nothing else runs.
//
// THE TOLERANCE. None: an integer, a list, and a presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined, assertEqual } from "../assert";
import { INFINITE_PIERCE, SHARD_LEVELS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the shard is posed. */
const SHARD = { x: 200, y: 0 };

/** The three moths' centers, each within `8 + 10` of the shard's. */
const ROW = [
  { x: 188, y: 0 },
  { x: 200, y: 0 },
  { x: 212, y: 0 },
];

/** The tick the shard's `ttl` is due on: `round(3.0 × 60)` = `180` after the pose. */
const DUE = ticksOf(SHARD_LEVELS[0].duration);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits three moths with a pierce -1 shard, still reads -1, and lives to the tick before its ttl is due", async () => {
  isolate(h);
  const moths = ROW.map((at) => placeEnemyNear(h, "moth", at.x, at.y));
  const shard = placeProjectile(
    h,
    "shard",
    SHARD.x,
    SHARD.y,
    0,
    0,
    INFINITE_PIERCE,
  );

  const struck = await advanceTicks(h, 1);
  captureStill(h, "infinite");

  assertDeepEqual(
    struck.run.enemies
      .filter((enemy) => moths.includes(enemy.id))
      .map((enemy) => enemy.id),
    [],
    "the three moths still alive after the shard's first tick, all three hit (specs/weapons.md, Projectiles and pierce)",
  );
  assertEqual(
    projectileById(struck, shard)?.pierce,
    INFINITE_PIERCE,
    "the shard's pierce after three hits (specs/weapons.md, Projectiles and pierce)",
  );

  const lived = await advanceTicks(h, DUE - 2);
  assertEqual(
    lived.run.tick - struck.run.tick,
    DUE - 2,
    "the ticks stepped to the tick before the ttl is due",
  );
  assertDefined(
    projectileById(lived, shard),
    `the shard in projectiles on tick ${DUE - 1} after the pose, the tick before its ttl is due (specs/weapons.md, Projectiles and pierce)`,
  );
});
