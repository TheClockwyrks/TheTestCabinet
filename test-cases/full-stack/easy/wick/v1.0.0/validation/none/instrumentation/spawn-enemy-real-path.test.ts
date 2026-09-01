// Wick — instrumentation/spawn-enemy-real-path: `spawnEnemy("moth", 200, 0)`
// on `playing` with the tick at 4500 appears in the next snapshot at
// `(200, 0)` with the next id, `age` 0, `contactCooldown` 0, and `maxHp`
// `5 × 1.15`, scaled by the run clock exactly as a director spawn is.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnEnemy(type, x, y)`): "Spawns one enemy of `type` ... centered at
// `(x, y)` through the real spawn path: its `maxHp` is scaled by the run clock
// exactly as a director spawn is, its `age` and `contactCooldown` are `0`, it
// takes the next id". specs/enemies.md — "Health scaling": "`hpMul(time) = 1 +
// HP_SCALE_PER_MINUTE * floor(time / 60)`" with `0.15`, "`maxHp = hp *
// hpMul(time)` and `hp = maxHp`"; a moth's HP is 5, and at 75 s the multiplier
// is 1.15. The product is read to `FLOAT_TOL`.
//
// WHY THE WORLD IS POSED AS IT IS. The clock is posed into the second minute
// so the scaling is not the trivial `1`, and the field is otherwise empty so
// the next id is the one the snapshot held before the call.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, hpMul, POSITION_TOL, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

const POSED_TICK = 4500;
const AT = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns through the real path, scaled by the run clock", async () => {
  await isolate(h);
  await h.debug.setTick(POSED_TICK);
  const before = await h.snapshot();

  const moth = await placeEnemy(h, "moth", AT.x, AT.y);
  await captureStill(h, "spawned");

  assertEqual(moth.id, before.run.nextId, "the spawn's id, the next id");
  assertNear(moth.x, AT.x, POSITION_TOL, "the spawn's x");
  assertNear(moth.y, AT.y, POSITION_TOL, "the spawn's y");
  assertEqual(moth.age, 0, "the spawn's age");
  assertEqual(moth.contactCooldown, 0, "the spawn's contact cooldown");
  const scaled = ENEMIES.moth.hp * hpMul(POSED_TICK / TICK_HZ);
  assertNear(moth.maxHp, scaled, FLOAT_TOL, "the spawn's maxHp, scaled by the clock");
  assertNear(moth.hp, scaled, FLOAT_TOL, "the spawn's hp, at its maxHp");
});
