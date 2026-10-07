// passives/wick-damage-mul — Wick multiplies a weapon's damage by
// 1 + WICK_DAMAGE_PER_LEVEL per level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("The derived stats"):
// "damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick", with
// WICK_DAMAGE_PER_LEVEL 0.1, so Wick 3 gives 1.3; and ("Damage") "A weapon's
// damage per hit is its table `damage` times `damageMul`. The result is a real
// number, and enemy health is a real number, so a hit removes exactly that
// amount." Row 1 of EMBER_LEVELS gives damage 10 (specs/weapons.md, "Ember"),
// so the bolt carries 10 × 1.3 = 13 and the enemy it hits loses 13.
//
// THE WORLD. An isolated playing run: nothing on the field, Wick at level 3 in
// the first passive slot, Ember alone at level 1 with its timer at 0, and one
// hound 200 units along +x as the target Ember needs. enemyMotion is off, so
// the hound holds the distance the pose gave it and its own contact never
// reaches the lamplighter; effectMotion is turned on only after the bolt has
// been read, because the bolt has to travel to reach the hound, and that is the
// one faculty this reading exercises.
//
// WHY A HOUND. It carries 120 health (specs/enemies.md), so a 13-point hit
// leaves it alive and the health it lost can be read off the snapshot; a moth
// would die and report nothing but its absence.
//
// WHAT IS READ. The bolt's `damage` on the firing tick, and the fall in the
// hound's `hp` across the tick the bolt reaches it. Both are decided: a build
// that scales the reported figure but applies the table damage, and one that
// applies the scaled damage without reporting it, each miss one reading.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on both, each a product of two stated
// figures read back as a double.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertWithin } from "../assert";
import {
  EMBER_LEVELS,
  FIGURE_TOLERANCE,
  derived,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  present,
  projectilesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives, probesAround } from "./night";

/** The passives held: Wick at level 3. */
const HELD: HeldPassives = { wick: 3 };

/** The Ember level fired: row 1, damage 10. */
const LEVEL = 1;

/** 10 × (1 + 0.1 × 3) = 13. */
const DAMAGE = EMBER_LEVELS[LEVEL - 1].damage * derived.damageMul(HELD);

/** The target: 120 health, radius 18, posed 200 units along +x. */
const TARGET = "hound";

/** How long the bolt is given to cross the 200 units, in ticks. */
const FLIGHT_BUDGET = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fires a bolt of damage 13 with Wick 3 held, and removes 13 from the hound", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const [target] = probesAround(h, TARGET, [{ x: 200, y: 0 }]);
  armAll(h, [["ember", LEVEL]]);

  const fired = await h.tick(1);
  captureStill(h, "damage");

  const bolts = projectilesOf(fired, "ember");
  assertLength(bolts, 1, "Ember bolts after the firing tick");
  assertWithin(
    bolts[0].damage,
    DAMAGE,
    FIGURE_TOLERANCE,
    "the bolt's damage per hit with Wick 3 held",
  );

  const before = present(enemyById(fired, target), "the hound before the hit");
  enable(h, "effectMotion");
  const hit = await h.until(
    (snapshot) => (enemyById(snapshot, target)?.hp ?? 0) < before.hp,
    { maxTicks: FLIGHT_BUDGET },
  );
  assertEqual(hit.hit, true, "whether the bolt reached the hound");

  const after = present(
    enemyById(hit.snapshot, target),
    "the hound after the hit",
  );
  assertWithin(
    before.hp - after.hp,
    DAMAGE,
    FIGURE_TOLERANCE,
    "the health the bolt removed from the hound",
  );
});
