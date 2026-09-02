// contact/damage-taken-floor — a contact hit removes at least MIN_DAMAGE_TAKEN:
// with Brass 3 held, a gnat's hit of 3 removes exactly 1.
//
// THE RULE, FROM THE SPEC. specs/passives.md, Armor: "damage taken =
// max(MIN_DAMAGE_TAKEN, enemy damage − armor) with MIN_DAMAGE_TAKEN (1), so
// every contact hit that lands removes at least 1 health whatever the armor.
// Brass tops out at level 3, so armor is at most 3." A gnat's damage is 3
// (specs/enemies.md), so at Brass 3 the difference is 0 and the floor applies:
// max(1, 3 − 3) = 1.
//
// THE POSE. An isolated night with enemyContact on: Brass at level 3, its max,
// in the first passive slot; one gnat posed 10 units along +x, inside the 20
// its radius 8 plus PLAYER_RADIUS sum to, held there with enemyMotion off. Its
// cooldown is 0 at spawn, so the hit lands on the first tick. Recovery is 0
// with no Tinder held, so hp goes from 100 to 99.
//
// THE TOLERANCE is FIGURE_TOLERANCE: exact arithmetic on stated figures. A
// build that skipped the floor removes 0 and reads 100, a whole unit away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  derived,
  ENEMIES,
  FIGURE_TOLERANCE,
  MIN_DAMAGE_TAKEN,
  PASSIVES,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdPassive,
  isolate,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy that hits: damage 3, radius 8. */
const TYPE = "gnat";

/** Where the gnat is posed: 10 units along +x, inside the overlap. */
const OFFSET = 10;

/** Brass at its max level, 3. */
const BRASS_LEVEL = PASSIVES.brass.maxLevel;

/** The armor Brass 3 gives: 1 × 3, equal to the gnat's damage. */
const ARMOR = derived.armor({ brass: BRASS_LEVEL });

/** max(1, 3 − 3) = 1: the floor. */
const DAMAGE_TAKEN = Math.max(MIN_DAMAGE_TAKEN, ENEMIES[TYPE].damage - ARMOR);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes exactly 1 from hp when the gnat's 3 meets Brass 3", async () => {
  isolate(h);
  enable(h, "enemyContact");
  holdPassive(h, "brass", BRASS_LEVEL);
  assertEqual(h.snapshot().run.armor, ARMOR, "armor with Brass 3 held");
  assertEqual(DAMAGE_TAKEN, MIN_DAMAGE_TAKEN, "the floor is what applies");
  spawnEnemyNear(h, TYPE, OFFSET, 0);

  const after = await h.tick(1);
  captureStill(h, "floor");

  assertWithin(
    after.run.player.hp,
    BASE_MAX_HP - MIN_DAMAGE_TAKEN,
    FIGURE_TOLERANCE,
    "hp after the floored hit",
  );
});
