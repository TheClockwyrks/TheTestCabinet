// instrumentation/spawn-projectile-figures — with Ember held at level 8 and
// Glass 2 and Wick 1 held, a posed ember reads radius 12, damage 27.5, and
// ttl 2.0; with Ember not held, a posed ember reads level 1's radius 8 × 1.2
// and damage 10 × 1.1.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `spawnProjectile`:
// "Its figures are the ones the weapon would give a projectile fired on this
// tick: `radius` is the weapon's table radius at the level held, or at level
// `1` ... when the weapon is not held, times the `areaMul` in force at the
// call; `damage` is that row's damage times the `damageMul` in force at the
// call; `ttl` is that row's duration". specs/weapons.md, Ember level 8: damage
// 25, radius 10, duration 2.0; level 1: damage 10, radius 8, duration 2.0.
// specs/passives.md: areaMul 1 + 0.1 × Glass, damageMul 1 + 0.1 × Wick.
//
// THE POSE. An isolated run with Glass 2 and Wick 1; a bolt posed with Ember
// held at 8, then Ember removed and a second bolt posed; each read at
// FIGURE_TOLERANCE, products of decimal figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import {
  derived,
  EMBER_LEVELS,
  FIGURE_TOLERANCE,
  MAX_WEAPON_LEVEL,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  projectileById,
  type Harness,
} from "../harness";

const HELD = { glass: 2, wick: 1 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the held row or the level-1 row, through the multipliers", async () => {
  isolate(h);
  holdPassive(h, "glass", HELD.glass);
  holdPassive(h, "wick", HELD.wick);
  const ember = holdWeapon(h, "ember", MAX_WEAPON_LEVEL);

  const heldId = h.snapshot().run.nextId;
  h.debug.spawnProjectile("ember", 200, 0, 0, 0, 0);
  const held = projectileById(h.snapshot(), heldId);
  assertDefined(held, "the bolt posed with Ember held at 8");
  const top = EMBER_LEVELS[MAX_WEAPON_LEVEL - 1];
  assertWithin(
    held?.radius ?? Number.NaN,
    top.radius * derived.areaMul(HELD),
    FIGURE_TOLERANCE,
    "radius, level 8",
  );
  assertWithin(
    held?.damage ?? Number.NaN,
    top.damage * derived.damageMul(HELD),
    FIGURE_TOLERANCE,
    "damage, level 8",
  );
  assertEqual(held?.ttl, top.duration, "ttl, level 8");

  h.debug.removeWeapon(ember);
  const unheldId = h.snapshot().run.nextId;
  h.debug.spawnProjectile("ember", -200, 0, 0, 0, 0);
  const unheld = projectileById(h.snapshot(), unheldId);
  await h.tick(1);
  captureStill(h, "figures");
  assertDefined(unheld, "the bolt posed with Ember not held");
  const first = EMBER_LEVELS[0];
  assertWithin(
    unheld?.radius ?? Number.NaN,
    first.radius * derived.areaMul(HELD),
    FIGURE_TOLERANCE,
    "radius, level 1",
  );
  assertWithin(
    unheld?.damage ?? Number.NaN,
    first.damage * derived.damageMul(HELD),
    FIGURE_TOLERANCE,
    "damage, level 1",
  );
  assertEqual(unheld?.ttl, first.duration, "ttl, level 1");
});
