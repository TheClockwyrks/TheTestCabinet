// Wick — weapons/pierce-infinite-never-lowered: a projectile with infinite
// pierce is never lowered and never removed by a hit.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile whose
//     `pierce` is `INFINITE_PIERCE` (`-1`) is never lowered and never removed
//     by a hit. A projectile's `ttl` is set to its `duration` when it is fired,
//     and it is removed on the tick `ttl` is due, whether or not it hit
//     anything."
//   - `specs/weapons.md` ("Shard"): "Its pierce is `INFINITE_PIERCE`", radius
//     `8`, damage `8`, duration `3.0` at level 1; `specs/enemies.md`: a moth
//     has HP `5`, radius `10`, so each hit kills and the overlap reaches 18
//     units.
//   - `specs/world.md` ("Timers"): a timer set to `s` is due `round(s ×
//     TICK_HZ)` ticks after it was set, so a shard posed with ttl `3.0` is due
//     180 ticks after the pose and is in the world on every tick before.
//   - `specs/instrumentation.md` (`spawnProjectile`): `pierce` may be posed
//     `INFINITE_PIERCE`, and a posed projectile "first hits ... on the next
//     tick".
//
// WHAT IS READ. After the tick on which the posed shard hits three moths at
// once: all three are gone, the shard is still in `projectiles`, and its
// pierce still reads `-1`. Then the shard is read on every tick up to the one
// before its ttl is due, and is present on each. The tick of its removal is
// another item's requirement and is not read here.
//
// WHY THE NIGHT IS POSED AS IT IS. Three moths in a row and one shard on the
// middle one, 150 units from the lamplighter, every switch off: with
// `effectMotion` off the shard neither moves nor bounces, so nothing but the
// hits and the ttl touch it.
//
// TOLERANCE. None: pierce is a whole count and presence is a fact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
import { ENEMIES, INFINITE_PIERCE, SHARD_LEVELS, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** Where the scene stands: along +x, clear of the lamplighter. */
const DX = 150;

/** The spacing of the row's moths along x, inside the shard's overlap. */
const ROW_STEP = 10;

/** The tick the shard's ttl is due, counted from the pose. */
const DUE_TICK = ticksFor(SHARD_LEVELS[0].duration);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a pierce -1 shard at -1 and in the world through three hits until its ttl", async () => {
  assertEqual(
    ROW_STEP < SHARD_LEVELS[0].radius + ENEMIES.moth.radius,
    true,
    "the row's step is inside the shard's overlap with a moth",
  );
  isolate(h);
  const row = [-ROW_STEP, 0, ROW_STEP].map((step) =>
    spawnEnemyNear(h, "moth", DX + step, 0),
  );
  const middle = present(
    enemyById(h.snapshot(), row[1]),
    "the row's middle moth",
  );
  const shard = spawnProjectileAt(
    h,
    "shard",
    middle.x,
    middle.y,
    0,
    0,
    INFINITE_PIERCE,
  );

  const after = await h.tick(1);
  captureStill(h, "infinite");

  for (const moth of row) {
    assertEqual(
      enemyById(after, moth),
      undefined,
      `moth ${moth} after the tick`,
    );
  }
  const survivor = present(
    projectileById(after, shard),
    "the shard after its three hits",
  );
  assertEqual(
    survivor.pierce,
    INFINITE_PIERCE,
    "the shard's pierce after its hits",
  );

  const trace = await h.trace(DUE_TICK - 2);
  trace.forEach((snapshot, index) => {
    assertDefined(
      projectileById(snapshot, shard),
      `the shard on tick ${index + 2} of ${DUE_TICK} after the pose`,
    );
  });
});
