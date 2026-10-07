// Wick — weapons/hit-removes-damage: a hit removes the shape's damage per hit
// from the enemy's hp.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Hits and death"): "A hit
// removes the shape's damage per hit from the enemy's `hp`. Damage per hit is
// the table damage times `damageMul`, a real number, and `hp` is real." Ember's
// level-1 row carries damage `10`, `damageMul` is `1` with no Wick held
// (`specs/passives.md`), and a rat spawns with `15` hp at a run clock of `0`
// (`specs/enemies.md`, `hpMul(0)` = `1`). So the rat reads `5` on the tick of
// the hit.
//
// THE POSE. A rat at `(100, 0)` and a level-1 Ember bolt posed on its center
// with zero velocity and pierce `0`: `spawnProjectile` gives it "that row's
// damage times the `damageMul` in force at the call", level 1 because Ember is
// not held, and "a posed ... projectile ... first hits on the next tick"
// (`specs/instrumentation.md`). Every faculty is held — the hits of phase 6
// resolve whatever the switches hold ("`ttl` and every re-hit entry still
// count, and hits still resolve") — so the one tick stepped does nothing but
// the hit. The rat stands `100` from the lamplighter, outside the `12 + 12`
// contact distance, and `enemyContact` is held besides.
//
// TOLERANCE. `FLOAT_TOL`: `15 − 10 × 1` is exact, and a build is free to
// multiply in any order.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  mustEnemy,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the rat stands: clear of the lamplighter, inside nothing else. */
const RAT = { x: 100, y: 0 };

/** Ember's level-1 damage, `10`, from `EMBER_LEVELS`. */
const BOLT_DAMAGE = weaponRow("ember", 1).damage;

/** A rat's table hp, `15`, unscaled at tick `0`. */
const RAT_HP = ENEMIES.rat.hp;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a rat at hp 5 on the tick a level-1 Ember bolt hits it", async () => {
  await isolate(h);
  const rat = await placeEnemy(h, "rat", RAT.x, RAT.y);
  assertEqual(rat.hp, RAT_HP, "the rat's hp as posed");
  const bolt = await placeProjectile(h, "ember", RAT.x, RAT.y, 0, 0, 0);
  assertNear(bolt.damage, BOLT_DAMAGE, FLOAT_TOL, "the posed bolt's damage");

  const hit = await h.step(1);
  await captureStill(h, "hit");

  assertNear(
    mustEnemy(hit, rat.id).hp,
    RAT_HP - BOLT_DAMAGE,
    FLOAT_TOL,
    "the rat's hp on the tick of the hit",
  );
});
