// Wick — instrumentation/spawn-projectile-figures: a posed projectile takes
// its figures from the weapon's row at the level held, or level 1 when it is
// not held, times the multipliers in force.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `spawnProjectile(...)`: "`radius` is the weapon's table radius at the level
// held, or at level `1` ... when the weapon is not held, times the `areaMul`
// in force at the call; `damage` is that row's damage times the `damageMul`
// in force at the call; `ttl` is that row's duration". `specs/weapons.md`,
// Ember level 8: damage 25, radius 10, duration 2.0; level 1: damage 10,
// radius 8. `specs/passives.md`: `areaMul = 1 + 0.1 × glass`, `damageMul =
// 1 + 0.1 × wick`, so with Glass 2 and Wick 1: 12 and 27.5 held at 8, 9.6 and
// 11 unheld. `REAL_EPS` on the products.
//
// THE POSES. An isolated run with Glass 2 and Wick 1 placed; one ember posed
// with Ember held at 8, one with Ember removed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { EMBER_LEVELS, REAL_EPS, areaMul, damageMul } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

const GLASS = 2;
const WICK = 1;
const HELD_LEVEL = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the row at the level held, and level 1 when not held, through the multipliers", async () => {
  isolate(h);
  holdPassive(h, "glass", GLASS);
  holdPassive(h, "wick", WICK);
  const ember = holdWeapon(h, "ember", HELD_LEVEL);

  const heldId = placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const held = projectileById(h.snapshot(), heldId);
  assertDefined(held, "the ember posed with Ember held at 8");
  const row = EMBER_LEVELS[HELD_LEVEL - 1];
  assertNear(
    held?.radius ?? Number.NaN,
    row.radius * areaMul(GLASS),
    REAL_EPS,
    "radius with Ember held at 8 and Glass 2",
  );
  assertNear(
    held?.damage ?? Number.NaN,
    row.damage * damageMul(WICK),
    REAL_EPS,
    "damage with Ember held at 8 and Wick 1",
  );
  assertEqual(held?.ttl, row.duration, "ttl with Ember held at 8");

  h.debug.removeWeapon(ember);
  h.debug.clearProjectiles();
  const unheldId = placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  const unheld = projectileById(h.snapshot(), unheldId);
  await h.frameDraw();
  captureStill(h, "figures");
  assertDefined(unheld, "the ember posed with Ember not held");
  const first = EMBER_LEVELS[0];
  assertNear(
    unheld?.radius ?? Number.NaN,
    first.radius * areaMul(GLASS),
    REAL_EPS,
    "radius with Ember not held and Glass 2",
  );
  assertNear(
    unheld?.damage ?? Number.NaN,
    first.damage * damageMul(WICK),
    REAL_EPS,
    "damage with Ember not held and Wick 1",
  );
  assertEqual(unheld?.ttl, first.duration, "ttl with Ember not held");
});
