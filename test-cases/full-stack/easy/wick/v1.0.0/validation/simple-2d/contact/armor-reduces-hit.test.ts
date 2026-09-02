// contact/armor-reduces-hit — armor reduces every contact hit by its level:
// with Brass 2 held, a rat's hit of 8 removes 6.
//
// THE RULE, FROM THE SPEC. specs/passives.md, Armor: "Armor is a flat reduction
// to each contact hit the lamplighter takes: damage taken =
// max(MIN_DAMAGE_TAKEN, enemy damage − armor)", with
// "armor = BRASS_ARMOR_PER_LEVEL × brass" and BRASS_ARMOR_PER_LEVEL 1. A rat's
// damage is 8 (specs/enemies.md), so at Brass 2 the hit removes
// max(1, 8 − 2) = 6, which is above the floor and so reads the reduction alone.
//
// THE POSE. An isolated night with enemyContact on: Brass at level 2 in the
// first passive slot through setPassive, which specs/instrumentation.md has
// take effect on "the next read", the hit being that read; one rat posed 20
// units along +x, inside the 24 its radius 12 plus PLAYER_RADIUS sum to, held
// there with enemyMotion off. Its cooldown is 0 at spawn, so the hit lands on
// the first tick. Recovery is 0 with no Tinder held, so hp goes from 100 to 94.
//
// THE TOLERANCE is FIGURE_TOLERANCE: exact arithmetic on stated figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  BASE_MAX_HP,
  derived,
  ENEMIES,
  FIGURE_TOLERANCE,
  MIN_DAMAGE_TAKEN,
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

/** The enemy that hits: damage 8, radius 12. */
const TYPE = "rat";

/** Where the rat is posed: 20 units along +x, inside the overlap. */
const OFFSET = 20;

/** The Brass level held. */
const BRASS_LEVEL = 2;

/** The armor Brass 2 gives: 1 × 2. */
const ARMOR = derived.armor({ brass: BRASS_LEVEL });

/** max(MIN_DAMAGE_TAKEN, 8 − 2) = 6. */
const DAMAGE_TAKEN = Math.max(MIN_DAMAGE_TAKEN, ENEMIES[TYPE].damage - ARMOR);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes 8 − 2 = 6 from hp when the rat hits with Brass 2 held", async () => {
  isolate(h);
  enable(h, "enemyContact");
  holdPassive(h, "brass", BRASS_LEVEL);
  assertEqual(h.snapshot().run.armor, ARMOR, "armor with Brass 2 held");
  spawnEnemyNear(h, TYPE, OFFSET, 0);

  const after = await h.tick(1);
  captureStill(h, "armored");

  assertWithin(
    after.run.player.hp,
    BASE_MAX_HP - DAMAGE_TAKEN,
    FIGURE_TOLERANCE,
    "hp after the armored hit",
  );
});
