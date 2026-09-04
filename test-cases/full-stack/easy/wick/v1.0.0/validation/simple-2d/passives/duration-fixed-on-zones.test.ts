// passives/duration-fixed-on-zones — a zone's duration is one of the figures no
// passive touches. A projectile's duration is
// `passives/duration-fixed-on-projectiles`'.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("What passives leave as
// written"): "Projectile `speed` and `duration` are used as written for every
// weapon, at every passive level, so a bolt travels the same distance and a
// lantern, puddle, shard, or sconce lasts the same time whatever the passives
// held". specs/weapons.md ("Derived stats") puts duration in the row "Speed,
// Pierce, Duration | table value, unchanged", and ("Projectiles and pierce") "A
// projectile's `ttl` is set to its `duration` when it is fired". Row 1 of
// EMBER_LEVELS gives duration 2.0 and row 1 of OIL_SPLASH_LEVELS gives 2.5
// (specs/weapons.md), so the readings are 2.0 and 2.5. specs/world.md ("One
// tick"), phase 6: only a shape "that existed before this tick" counts its
// `ttl` down, so the figures read after the firing tick are the ones the firing
// set.
//
// THE WORLD. An isolated playing run holding the four passives that scale a
// weapon's figures at once, at levels that would move a duration the furthest
// if any of them reached it: Glass 5, Oil 5, Wick 5, and Mirror 2. Ember and
// Oil Splash are held at level 1 with both timers at 0, and three moths stand
// 300 units out in three directions, enough targets for the amount Mirror 2
// raises each level-1 row to, so every shape the firing produces is read. Every driver switch is
// off but weaponFire, so the moths hold their distances and nothing but the
// firing changes the world.
//
// WHAT IS READ. Every Ember bolt's `ttl` after the firing tick, 2.0, and every
// Oil Splash puddle's, 2.5. How MANY of each there are is not read: the amount
// Mirror raises is another point's requirement, and this one asks only that
// there is a shape to read a duration off.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on each, a stated figure read back as a
// double.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  OIL_SPLASH_LEVELS,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  present,
  zonesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** Every passive that scales a weapon's figures, at a high level. */
const HELD: HeldPassives = { glass: 5, oil: 5, wick: 5, mirror: 2 };

/** The level the weapon is held at: row 1 of its table. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives every puddle ttl 2.5 under four passives", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["oil-splash", LEVEL]]);

  const after = await h.tick(1);
  captureStill(h, "duration");

  const puddles = zonesOf(after, "oil-splash");
  assertGreaterThanOrEqual(
    puddles.length,
    1,
    "Oil Splash puddles after the firing tick, so a ttl is there to read",
  );
  for (const puddle of puddles) {
    assertWithin(
      present(puddle.ttl, `puddle ${puddle.id}: ttl`),
      OIL_SPLASH_LEVELS[LEVEL - 1].duration,
      FIGURE_TOLERANCE,
      `puddle ${puddle.id}: ttl on the tick it was laid`,
    );
  }
});
