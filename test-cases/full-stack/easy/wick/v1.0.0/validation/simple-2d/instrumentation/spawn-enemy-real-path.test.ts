// instrumentation/spawn-enemy-real-path — `spawnEnemy('moth', 200, 0)` on
// playing with the tick at 4500 appears in the next snapshot at (200, 0) with
// the next id, age 0, contactCooldown 0, and maxHp 5 × 1.15 = 5.75, scaled by
// the run clock exactly as a director spawn is.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnEnemy`:
// "Spawns one enemy of `type` ... centered at `(x, y)` through the real spawn
// path: its `maxHp` is scaled by the run clock exactly as a director spawn is,
// its `age` and `contactCooldown` are `0`, it takes the next id". "A pose
// that creates an entity gives it the next id from `nextId`". specs/enemies.md,
// "Health scaling": "hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)"
// with HP_SCALE_PER_MINUTE 0.15; at 75 s that is 1.15, and the moth's row hp
// is 5, so maxHp is 5.75 and "hp begins at maxHp".
//
// THE POSE. An isolated run, the clock posed to 4500, the spawn, the read
// back without a frame, compared at FIGURE_TOLERANCE since 5.75 is a product
// of two decimal figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, hpMul, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

const TICK = 4500;
const AT = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spawns the moth through the real path, scaled by the clock", async () => {
  isolate(h);
  h.debug.setTick(TICK);
  const nextId = h.snapshot().run.nextId;

  const id = spawnEnemyAt(h, "moth", AT.x, AT.y);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "spawned");

  assertEqual(id, nextId, "the id the spawn took: the next id");
  assertEqual(s.run.nextId, nextId + 1, "nextId after the spawn");
  const moth = enemyById(s, id);
  assertDefined(moth, "the moth in the snapshot");
  assertEqual(moth?.type, "moth", "its type");
  assertEqual(moth?.x, AT.x, "its x");
  assertEqual(moth?.y, AT.y, "its y");
  assertEqual(moth?.age, 0, "its age");
  assertEqual(moth?.contactCooldown, 0, "its contactCooldown");
  const scaled = ENEMIES.moth.hp * hpMul(TICK / TICK_HZ);
  assertWithin(
    moth?.maxHp ?? Number.NaN,
    scaled,
    FIGURE_TOLERANCE,
    "its maxHp, scaled",
  );
  assertWithin(
    moth?.hp ?? Number.NaN,
    scaled,
    FIGURE_TOLERANCE,
    "its hp, at maxHp",
  );
});
