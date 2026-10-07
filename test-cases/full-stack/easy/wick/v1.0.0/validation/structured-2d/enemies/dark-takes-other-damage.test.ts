// enemies/dark-takes-other-damage — every weapon but Flare damages the Dark
// exactly as it damages anything else.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Elites and the Dark"):
// "Every other weapon damages the Dark exactly as it damages any enemy."
// `specs/weapons.md` ("Hits and death") gives what that means in numbers: "A
// hit removes the shape's damage per hit from the enemy's `hp`. Damage per hit
// is the table damage times `damageMul`". Ember's level-1 row gives damage
// `10` ("Ember"), and with no Wick held `damageMul` is `1`
// (`specs/passives.md`), so one bolt removes exactly `10`. The Dark spawns
// "with exactly the HP in its row", `10000` ("Elites and the Dark"), so the
// tick the bolt hits leaves it at `9990`. Exactly the row's damage, no more
// and no less, is the claim: a build that halved a hit on the Dark, or that
// extended the Flare exception to every weapon, fails.
//
// WHY THE BOLT IS POSED RATHER THAN FIRED. `spawnProjectile` "Adds one
// projectile of `weapon` ... Its figures are the ones the weapon would give a
// projectile fired on this tick: ... `damage` is that row's damage times the
// `damageMul` in force at the call" at level `1` "when the weapon is not held"
// (`specs/instrumentation.md`), and "a posed enemy, projectile, ... first
// hits ... on the next tick", so one bolt at the Dark's own center is one
// certain hit one tick later, with no flight to wait out and no targeting to
// go wrong. Whether Ember aims and fires is `ember/`'s business; this check
// is the hit landing on the Dark.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding the Dark alone,
// `POST` (200) units out, with every driver switch off: `effectMotion` off
// leaves the bolt where it was posed while "hits still resolve"
// (`specs/instrumentation.md`), `enemyMotion` off leaves the Dark where it was
// posed, `enemyContact` off keeps its touch off the lamplighter, and no weapon
// is held, so the only thing that can change the Dark's `hp` on the tick that
// runs is the bolt. A bolt's radius `8` and the Dark's `40` overlap at a
// distance of `0` by a wide margin (`specs/weapons.md`, Shapes and overlap).
//
// THE TOLERANCE. `REAL_EPS`: the expectation is the health read a tick earlier
// less one table figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { EMBER_LEVELS, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";
import { requireEnemy } from "./roster";

/** Where the Dark stands: clear of the lamplighter, so nothing else touches it. */
const POST = 200;

/** Ember's level-1 damage, `10`, the damage a bolt posed with Ember unheld carries. */
const DAMAGE = EMBER_LEVELS[0].damage;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("takes the Dark from 10000 hp to 9990 on the tick a level-1 Ember bolt hits it", async () => {
  isolate(h);
  const dark = placeEnemyNear(h, "dark", POST, 0);
  const before = requireEnemy(h.snapshot(), dark);
  placeProjectile(h, "ember", before.x, before.y, 0, 0, 0);

  const struck = await advanceTicks(h, 1);
  captureStill(h, "hit");

  assertNear(
    requireEnemy(struck, dark).hp,
    before.hp - DAMAGE,
    REAL_EPS,
    "the Dark's hp on the tick a level-1 Ember bolt hit it (specs/enemies.md, Elites and the Dark)",
  );
});
