// contact/armor-reduces-hit — armor reduces every contact hit by its level.
//
// WHERE THE THRESHOLD COMES FROM. specs/passives.md ("Armor"): "Armor is a flat
// reduction to each contact hit the lamplighter takes: `damage taken =
// max(MIN_DAMAGE_TAKEN, enemy damage - armor)`", and "The derived stats":
// "`armor = BRASS_ARMOR_PER_LEVEL x brass`" with `BRASS_ARMOR_PER_LEVEL` 1, so
// Brass at level 2 is armor 2. A rat's damage is 8 (specs/enemies.md — "Rat |
// `rat` | 15 | 120 | 8 | 12"), so its hit removes `8 - 2 = 6`, and `hp` reads
// `100 - 6 = 94` from full.
//
// THE DRIVE. An isolated night with `enemyContact` on and `enemyMotion` off,
// Brass at level 2 held through `setPassive`, and one rat 5 units from the
// lamplighter's center, well inside its radius 12 plus `PLAYER_RADIUS` 12. The
// rat's cooldown is the 0 it spawned with, so it hits on the first tick. "A
// derived stat is computed from the levels held at the moment it is read"
// (specs/passives.md), so the armor posed before the tick is the armor the hit
// reads. Recovery is 0 with no Tinder held, so nothing else moves `hp`.
//
// THE TOLERANCE. `FLOAT_TOL`: `100 - (8 - 2)` is exact. The nearest wrong
// answers, an unarmored 92 and a per-level percentage, are whole units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  BASE_MAX_HP,
  ENEMIES,
  FLOAT_TOL,
  armorOf,
  damageTaken,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  placeEnemyNear,
  player,
  type Harness,
} from "../harness";

/** The Brass level held: armor 2. */
const BRASS_LEVEL = 2;

/** How far from the center the rat is posed: well inside 12 + 12. */
const RAT_OFFSET = 5;

/** `100 - max(1, 8 - 2)`. */
const EXPECTED_HP =
  BASE_MAX_HP -
  damageTaken(ENEMIES.rat.damage, armorOf({ brass: BRASS_LEVEL }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes 8 - 2 = 6 from hp on a rat's hit with Brass 2 held", async () => {
  await isolate(h, { on: ["enemyContact"] });
  await holdPassive(h, "brass", BRASS_LEVEL);
  await placeEnemyNear(h, "rat", RAT_OFFSET, 0);

  const after = await h.step(1);

  // The HUD with the armored hit landed. Captured before the assertion, so a
  // failing build leaves the picture that shows why.
  await captureStill(h, "armored");

  assertNear(
    player(after).hp,
    EXPECTED_HP,
    FLOAT_TOL,
    "hp after one rat hit with Brass 2 held",
  );
});
