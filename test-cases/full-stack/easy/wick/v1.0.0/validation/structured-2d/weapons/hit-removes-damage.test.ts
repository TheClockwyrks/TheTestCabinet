// weapons/hit-removes-damage — a hit removes the shape's damage per hit from
// the enemy's hp.
//
// THE SPEC LINE. `specs/weapons.md`, "Hits and death": "A hit removes the
// shape's damage per hit from the enemy's `hp`. Damage per hit is the table
// damage times `damageMul`, a real number, and `hp` is real." Ember's level-1
// row gives damage `10`, and with no Wick held `damageMul` is `1`
// (`specs/passives.md`), so one bolt removes exactly `10`. A rat spawns with
// `15` hp (`specs/enemies.md`, Common enemies) at a run clock of `0`, where the
// health scaling is `1`, so after the hit it reads `5`.
//
// THE POSE. One rat at `(200, 0)`, then an Ember bolt posed through
// `spawnProjectile` at the rat's own center with zero velocity and pierce `0`:
// "a posed enemy, projectile, ... first hits ... on the next tick"
// (`specs/instrumentation.md`), and its damage "is that row's damage times the
// `damageMul` in force at the call", at level `1` since Ember is not held. The
// bolt's radius `8` and the rat's `12` overlap at distance `0`, so the next
// tick's hit is certain. `effectMotion` is held, which leaves the bolt where it
// was posed while "hits still resolve"; `enemyContact` is held so the rat's
// contact damage never enters; nothing else runs, so the only change to the
// rat's `hp` on that tick is the hit. The expectation is the rat's `hp` before
// the tick less the row's damage, so what is graded is the removal alone.
//
// THE TOLERANCE. `15 − 10` is one subtraction of two small reals, so the
// reading is held to `REAL_EPS`.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { EMBER_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the rat stands: clear of the lamplighter, so nothing else touches it. */
const RAT = { x: 200, y: 0 };

/** Ember's level-1 damage, `10`, the damage a bolt posed with Ember unheld carries. */
const DAMAGE = EMBER_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes a rat from 15 hp to 5 on the tick a level-1 Ember bolt hits it", async () => {
  isolate(h);
  const rat = placeEnemyNear(h, "rat", RAT.x, RAT.y);
  const posed = h.snapshot();
  const before = enemyById(posed, rat);
  if (before === undefined) throw new Error("the posed rat is missing");
  placeProjectile(h, "ember", before.x, before.y, 0, 0, 0);

  const struck = await advanceTicks(h, 1);
  captureStill(h, "hit");

  assertNear(
    enemyById(struck, rat)?.hp ?? NaN,
    before.hp - DAMAGE,
    REAL_EPS,
    `the rat's hp after one hit of ${DAMAGE} from ${before.hp} (specs/weapons.md, Hits and death)`,
  );
});
