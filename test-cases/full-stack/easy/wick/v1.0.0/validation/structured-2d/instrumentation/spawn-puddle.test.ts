// Wick — instrumentation/spawn-puddle: `spawnPuddle('oil-splash', 50, 50)`
// with Oil Splash not held appears as a puddle at (50, 50) with radius 50,
// damage 4, ttl 2.5, and empty hits, pulses on an overlapping enemy on the
// next tick, and pulses again 18 ticks later.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnPuddle(weapon, x, y)`: "Adds one zone of kind `puddle` ... `radius`
// is the weapon's table radius at ... level `1` ... when the weapon is not
// held ... `damage` is that row's damage ... `ttl` is that row's duration;
// `hits` is empty. It pulses first on the next tick and every `OIL_PULSE`
// ... after." `specs/weapons.md`, Oil Splash level 1: damage 4, radius 50,
// duration 2.5; `OIL_PULSE` 0.3, which is 18 ticks. A hound (120 hp) on the
// puddle's center takes 4 per pulse.
//
// THE DRIVE. An isolated run, a hound at (50, 50), the puddle read at the
// call, one tick (first pulse), 17 more (no pulse), one more (the second).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertDefined, assertEqual } from "../assert";
import { ENEMIES, OIL_PULSE, OIL_SPLASH_LEVELS, ticksOf } from "../constants";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  placeEnemy,
  placePuddle,
  zoneById,
  type Harness,
} from "../harness";

const X = 50;
const Y = 50;
const PULSE_TICKS = ticksOf(OIL_PULSE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("adds the posed puddle and it pulses on the next tick and every 18 after", async () => {
  isolate(h);
  const hound = placeEnemy(h, "hound", X, Y);
  const id = placePuddle(h, "oil-splash", X, Y);
  const posed = zoneById(h.snapshot(), id);
  assertDefined(posed, "the posed puddle");
  const row = OIL_SPLASH_LEVELS[0];
  assertEqual(posed?.kind, "puddle", "its kind");
  assertEqual(posed?.weapon, "oil-splash", "its weapon");
  assertEqual(posed?.x, X, "its x");
  assertEqual(posed?.y, Y, "its y");
  assertEqual(posed?.radius, row.radius, "its radius");
  assertEqual(posed?.damage, row.damage, "its damage");
  assertEqual(posed?.ttl, row.duration, "its ttl");
  assertDeepEqual(posed?.hits, [], "its hits");

  const { first, between, second } = await captureReplay(
    h,
    "puddle",
    async () => {
      const first = await advanceTicks(h, 1);
      const between = await advanceTicks(h, PULSE_TICKS - 1);
      const second = await advanceTicks(h, 1);
      return { first, between, second };
    },
  );
  const full = ENEMIES.hound.hp;
  assertEqual(
    enemyById(first, hound)?.hp,
    full - row.damage,
    "the hound's hp after the first pulse",
  );
  assertEqual(
    enemyById(between, hound)?.hp,
    full - row.damage,
    `the hound's hp ${PULSE_TICKS - 1} ticks after the first pulse`,
  );
  assertEqual(
    enemyById(second, hound)?.hp,
    full - 2 * row.damage,
    `the hound's hp on the ${PULSE_TICKS}th tick after the first pulse`,
  );
});
