// Wick — instrumentation/spawn-enemy-real-path: `spawnEnemy('moth', 200, 0)`
// on `playing` with the tick at 4500 appears at (200, 0) with the next id,
// age 0, contactCooldown 0, and `maxHp` `5 × 1.15`, scaled by the run clock
// exactly as a director spawn is.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnEnemy(type, x, y)`: "through the real spawn path: its `maxHp` is
// scaled by the run clock exactly as a director spawn is, its `age` and
// `contactCooldown` are `0`, it takes the next id". `specs/enemies.md`,
// "Health scaling": `hpMul(time) = 1 + HP_SCALE_PER_MINUTE (0.15) ×
// floor(time / 60)`, so at 75 s a moth's 5 hp scales to 5.75, and `hp` begins
// at `maxHp`. `REAL_EPS` on the product.
//
// THE POSE. An isolated run with the clock posed to 4500, the id read off
// `nextId` before the call, the call, read at the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { ENEMIES, REAL_EPS, TICK_HZ, hpMul } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_TICK = 4500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns through the real path, health scaled by the clock", async () => {
  isolate(h);
  h.debug.setTick(POSED_TICK);
  const expectedId = h.snapshot().run.nextId;
  const id = placeEnemy(h, "moth", 200, 0);
  const s = h.snapshot();
  await h.frameDraw();
  captureStill(h, "spawned");

  assertEqual(id, expectedId, "the id the spawn took");
  assertEqual(s.run.nextId, expectedId + 1, "run.nextId after the spawn");
  const moth = enemyById(s, id);
  assertDefined(moth, "the spawned moth");
  if (moth === undefined) return;
  assertEqual(moth.type, "moth", "its type");
  assertEqual(moth.x, 200, "its x");
  assertEqual(moth.y, 0, "its y");
  assertEqual(moth.age, 0, "its age at spawn");
  assertEqual(moth.contactCooldown, 0, "its contactCooldown at spawn");
  const scaled = ENEMIES.moth.hp * hpMul(POSED_TICK / TICK_HZ);
  assertNear(moth.maxHp, scaled, REAL_EPS, "its maxHp scaled at 75 s");
  assertNear(moth.hp, scaled, REAL_EPS, "its hp at spawn");
});
