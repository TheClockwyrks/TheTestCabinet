// Wick — weapons/pierce-infinite-never-lowered: infinite pierce is never lowered
// or spent.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "A projectile whose `pierce` is `INFINITE_PIERCE` (`-1`) is never
// lowered and never removed by a hit. A projectile's `ttl` is set to its
// `duration` when it is fired, and it is removed on the tick `ttl` is due". A
// shard's level-1 row carries duration `3.0`, so a posed shard lives `180`
// ticks by the timer rule of `specs/world.md`; after hitting three moths on
// its first tick it still reads `-1` and is still in `projectiles` on the
// `179`th.
//
// THE POSE. Three moths inside one shard's circle — a shard's level-1 radius
// is `8` and a moth's `10`, so moths `10` above and below the center are
// within the `18` overlap distance — and a shard posed on the center with zero
// velocity and pierce `-1`. Its `8` damage takes each moth's `5` hp below
// zero, so all three hits are seen as moths gone. Every faculty is held:
// `effectMotion` so the shard stands where it was posed rather than bouncing,
// and the rest so nothing else lands in the night. The shard's ttl still
// counts under every switch.
//
// TOLERANCE. None: pierce is a whole number and the rest is presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { ENEMIES, INFINITE_PIERCE, dueTicks, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  mustProjectile,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the shard lies, clear of the lamplighter. */
const SHARD = { x: 200, y: 0 };

/** The outer moths' offset from the center: inside the `8 + 10` overlap distance. */
const ROW_GAP = ENEMIES.moth.radius;

/** The tick the shard's ttl is due: `round(3.0 × 60)` = `180` after the pose. */
const EXPIRY = dueTicks(weaponRow("shard", 1).duration!);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a pierce -1 shard, unlowered, through three hits to the tick before its ttl", async () => {
  assertTrue(
    ROW_GAP < weaponRow("shard", 1).radius! + ENEMIES.moth.radius,
    "the outer moths inside the shard's overlap distance",
  );

  await isolate(h);
  const row = [
    await placeEnemy(h, "moth", SHARD.x, SHARD.y - ROW_GAP),
    await placeEnemy(h, "moth", SHARD.x, SHARD.y),
    await placeEnemy(h, "moth", SHARD.x, SHARD.y + ROW_GAP),
  ];
  const shard = await placeProjectile(
    h,
    "shard",
    SHARD.x,
    SHARD.y,
    0,
    0,
    INFINITE_PIERCE,
  );
  const posed = await h.snapshot();

  const hits = await h.step(1);
  await captureStill(h, "infinite");
  assertEqual(
    row.filter((moth) => enemyById(hits, moth.id) !== undefined).length,
    0,
    "moths still standing after the shard's tick",
  );
  assertEqual(
    mustProjectile(hits, shard.id).pierce,
    INFINITE_PIERCE,
    "the shard's pierce after three hits",
  );

  const beforeDue = await h.step(EXPIRY - 2);
  assertEqual(
    beforeDue.run.tick - posed.run.tick,
    EXPIRY - 1,
    "ticks stepped since the pose",
  );
  assertEqual(
    mustProjectile(beforeDue, shard.id).pierce,
    INFINITE_PIERCE,
    "the shard's pierce on the tick before its ttl is due",
  );
});
