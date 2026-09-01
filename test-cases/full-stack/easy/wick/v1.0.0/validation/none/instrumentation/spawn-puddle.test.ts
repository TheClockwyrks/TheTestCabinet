// Wick — instrumentation/spawn-puddle: `spawnPuddle("oil-splash", 50, 50)`
// with Oil Splash not held appears as a zone of kind `puddle` at `(50, 50)`
// with `radius` 50, `damage` 4, `ttl` 2.5, and empty `hits`, pulses on an
// overlapping enemy on the next tick, and pulses again 18 ticks later.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `spawnPuddle(weapon, x, y)`): "Adds one zone of kind `puddle` ... centered
// at `(x, y)`: `radius` is the weapon's table radius ... at level `1` ... when
// the weapon is not held, times the `areaMul` in force; `damage` is that
// row's damage times the `damageMul` in force; `ttl` is that row's duration;
// `hits` is empty. It pulses first on the next tick and every `OIL_PULSE` or
// `BLAZE_PULSE` after." `OIL_SPLASH_LEVELS` row 1 is radius 50, damage 4,
// duration 2.5; `OIL_PULSE` (`0.3`) is 18 ticks. A pulse "deals `damage` to
// every enemy overlapping it" (specs/weapons.md). Each figure is a table
// value under multipliers of `1`, read exactly.
//
// WHY THE WORLD IS POSED AS IT IS. A hound (120 hp) stands at the puddle's
// center with every faculty held, so each pulse takes exactly the puddle's
// damage from it and nothing else touches it; the frames are stepped one at a
// time so the pulse ticks are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import {
  dueTicks,
  FLOAT_TOL,
  OIL_PULSE,
  POSITION_TOL,
  weaponRow,
} from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  placePuddle,
  type Harness,
} from "../harness";

const AT = { x: 50, y: 50 };
const PULSE_TICKS = dueTicks(OIL_PULSE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("adds a posed puddle with the row's figures, pulsing on its interval", async () => {
  await isolate(h);
  const hound = await placeEnemy(h, "hound", AT.x, AT.y);
  const row = weaponRow("oil-splash", 1);

  const puddle = await placePuddle(h, "oil-splash", AT.x, AT.y);
  assertEqual(puddle.kind, "puddle", "the zone's kind");
  assertEqual(puddle.weapon, "oil-splash", "the zone's weapon");
  assertNear(puddle.x, AT.x, POSITION_TOL, "the puddle's x");
  assertNear(puddle.y, AT.y, POSITION_TOL, "the puddle's y");
  assertEqual(puddle.radius, row.radius, "the puddle's radius");
  assertEqual(puddle.damage, row.damage, "the puddle's damage");
  assertEqual(puddle.ttl, row.duration, "the puddle's ttl");
  assertDeepEqual(puddle.hits, [], "the puddle's hits");

  const seen = await captureReplay(h, "puddle", () =>
    h.stepWatching(PULSE_TICKS + 1),
  );
  const oncePulsed = hound.hp - row.damage;
  assertNear(
    mustEnemy(seen[0]!, hound.id).hp,
    oncePulsed,
    FLOAT_TOL,
    "the hound's hp after the first pulse, on the next tick",
  );
  for (let frame = 2; frame <= PULSE_TICKS; frame += 1) {
    assertNear(
      mustEnemy(seen[frame - 1]!, hound.id).hp,
      oncePulsed,
      FLOAT_TOL,
      `the hound's hp on tick ${frame}, between pulses`,
    );
  }
  assertNear(
    mustEnemy(seen[PULSE_TICKS]!, hound.id).hp,
    oncePulsed - row.damage,
    FLOAT_TOL,
    `the hound's hp on tick ${PULSE_TICKS + 1}, after the second pulse`,
  );
});
