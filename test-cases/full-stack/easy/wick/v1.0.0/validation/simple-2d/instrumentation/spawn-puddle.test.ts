// instrumentation/spawn-puddle — `spawnPuddle('oil-splash', 50, 50)` with Oil
// Splash not held appears as a zone of kind puddle at (50, 50) with radius
// 50, damage 4, ttl 2.5, and empty hits, pulses on an overlapping moth on the
// next tick, and pulses again 18 ticks later.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnPuddle`:
// "Adds one zone of kind `puddle` for `weapon` ... centered at `(x, y)`:
// `radius` is the weapon's table radius at the level held, or at level `1`
// ... when the weapon is not held, times the `areaMul` in force at the call;
// `damage` is that row's damage times the `damageMul` in force at the call;
// `ttl` is that row's duration; `hits` is empty. It pulses first on the next
// tick and every `OIL_PULSE` ... after". specs/weapons.md, Oil Splash level
// 1: damage 4, radius 50, duration 2.5; OIL_PULSE 0.3, which is 18 ticks. A
// moth has 5 hp: the first pulse leaves 1, the second kills it.
//
// THE POSE. An isolated run with no passive, a moth at the puddle's center
// with contact off, the pose read back, then a trace: the moth's hp falls by
// 4 on tick 1 and the moth dies on tick 19.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDefined,
  assertEqual,
  assertUndefined,
  assertWithin,
} from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  OIL_PULSE,
  OIL_SPLASH_LEVELS,
  ticksFor,
} from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  spawnEnemyAt,
  zoneById,
  type Harness,
} from "../harness";

const AT = { x: 50, y: 50 };
const PULSE_TICKS = ticksFor(OIL_PULSE);
const ROW = OIL_SPLASH_LEVELS[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds the puddle as the level-1 row gives it, pulsing on schedule", async () => {
  isolate(h);
  const moth = spawnEnemyAt(h, "moth", AT.x, AT.y);
  const id = h.snapshot().run.nextId;

  h.debug.spawnPuddle("oil-splash", AT.x, AT.y);
  const puddle = zoneById(h.snapshot(), id);
  assertDefined(puddle, "the puddle under the next id");
  assertEqual(puddle?.kind, "puddle", "its kind");
  assertEqual(puddle?.weapon, "oil-splash", "its weapon");
  assertEqual(puddle?.x, AT.x, "its x");
  assertEqual(puddle?.y, AT.y, "its y");
  assertWithin(
    puddle?.radius ?? Number.NaN,
    ROW.radius,
    FIGURE_TOLERANCE,
    "its radius",
  );
  assertWithin(
    puddle?.damage ?? Number.NaN,
    ROW.damage,
    FIGURE_TOLERANCE,
    "its damage",
  );
  assertEqual(puddle?.ttl, ROW.duration, "its ttl");
  assertDeepEqual(puddle?.hits, [], "its hits");

  const seen = await captureReplay(h, "puddle", () => h.trace(PULSE_TICKS + 1));
  assertWithin(
    enemyById(seen[0], moth)?.hp ?? Number.NaN,
    ENEMIES.moth.hp - ROW.damage,
    FIGURE_TOLERANCE,
    "the moth's hp after the first pulse, on the next tick",
  );
  assertWithin(
    enemyById(seen[PULSE_TICKS - 1], moth)?.hp ?? Number.NaN,
    ENEMIES.moth.hp - ROW.damage,
    FIGURE_TOLERANCE,
    "the moth's hp a tick before the second pulse",
  );
  assertUndefined(
    enemyById(seen[PULSE_TICKS], moth),
    "the moth, killed by the second pulse",
  );
});
