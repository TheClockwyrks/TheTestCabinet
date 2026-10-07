// Wick — weapons/hit-removes-damage: a hit removes the shape's damage per hit
// from the enemy's hp, as a real number, on the tick of the hit.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Hits and death"): "A hit removes the shape's damage
//     per hit from the enemy's `hp`. Damage per hit is the table damage times
//     `damageMul`, a real number, and `hp` is real." With no Wick held
//     `damageMul` is `1` (`specs/passives.md`).
//   - `specs/weapons.md` ("Ember"): the level-1 row has damage `10`, radius
//     `8`; `specs/enemies.md` ("The roster"): a rat has HP `15`, radius `12`.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed Ember bolt's
//     "`damage` is that row's damage times the `damageMul` in force at the
//     call", the level-1 row when Ember is not held, and a posed projectile
//     "first hits ... on the next tick".
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii", so
//     a bolt posed on the rat's center overlaps it.
//
// WHAT IS READ. The rat's `hp` after the one tick on which the posed bolt
// hits it: the rat's 15 less the bolt's 10, which is 5. The bolt's own
// `damage` is read before the tick so the figure removed is the one the bolt
// carried, not one this check assumed.
//
// WHY THE NIGHT IS POSED AS IT IS. One rat and one bolt, every switch off:
// hits resolve whatever the switches hold ("hits still resolve",
// `specs/instrumentation.md`), `enemyMotion` off keeps the rat under the bolt,
// and nothing else on the field can touch its hp. The rat stands 150 units from
// the lamplighter, beyond any contact.
//
// TOLERANCE. `FIGURE_TOLERANCE`: 15 − 10 is exact arithmetic on two stated
// figures, so 1e-9 is headroom for a build holding hp as a real number.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { EMBER_LEVELS, ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** The enemy hit: hp 15. */
const TYPE = "rat";

/** Where the rat stands: along +x, well clear of the lamplighter. */
const RAT_DX = 150;

/** The bolt's damage per hit: Ember's level-1 damage with no Wick held. */
const DAMAGE = EMBER_LEVELS[0].damage;

/** What the rat reads after the hit. */
const EXPECTED_HP = ENEMIES[TYPE].hp - DAMAGE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the bolt's 10 damage from the rat's 15 hp on the tick of the hit", async () => {
  isolate(h);
  const rat = spawnEnemyNear(h, TYPE, RAT_DX, 0);
  const placed = present(enemyById(h.snapshot(), rat), "the posed rat");
  assertWithin(
    placed.hp,
    ENEMIES[TYPE].hp,
    FIGURE_TOLERANCE,
    "the rat's hp at spawn",
  );
  const bolt = spawnProjectileAt(h, "ember", placed.x, placed.y, 0, 0, 0);
  const posedBolt = present(
    projectileById(h.snapshot(), bolt),
    "the posed bolt",
  );
  assertWithin(
    posedBolt.damage,
    DAMAGE,
    FIGURE_TOLERANCE,
    "the bolt's damage per hit",
  );

  const after = await h.tick(1);
  captureStill(h, "hit");

  const hit = present(enemyById(after, rat), "the rat after the hit");
  assertWithin(
    hit.hp,
    EXPECTED_HP,
    FIGURE_TOLERANCE,
    "the rat's hp after the hit",
  );
});
