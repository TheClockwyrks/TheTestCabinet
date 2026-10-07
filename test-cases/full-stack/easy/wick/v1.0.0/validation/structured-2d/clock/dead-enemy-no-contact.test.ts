// Wick — clock/dead-enemy-no-contact: an enemy killed on a tick lands no hit
// on that tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 6, "every projectile and zone
//     hits, this tick's new ones included ... Then an enemy whose `hp` is at
//     or below `0` dies", comes before phase 7, "Contact. Every live enemy's
//     `contactCooldown` counts down, and, while `enemyContact` is on, an
//     overlapping enemy whose cooldown is due hits".
//   - `specs/world.md` ("Contact damage"): "An overlapping enemy whose
//     `contactCooldown` is due lands a hit: `hp` falls by
//     `max(MIN_DAMAGE_TAKEN, enemy damage - armor)`". A moth's damage is 5
//     and its cooldown is `0`, due, when it spawns.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed bolt takes the
//     weapon's figures, "and a posed enemy, projectile ... first hits ... on
//     the next tick, exactly as one a tick created." Ember's level 1 damage
//     is 10, a moth's hp 5.
//
// THE DRIVE. An isolated run with `enemyContact` on and every other switch
// off. A moth is posed 5 units from the lamplighter, overlapping it with its
// cooldown due, and an Ember bolt is posed on the moth with no velocity. On
// the one tick that runs, the bolt hits in phase 6 and the moth dies there,
// so by phase 7 there is no live moth to land the hit that its overlap and
// due cooldown would otherwise deliver: `hp` reads `BASE_MAX_HP` untouched,
// and `kills` reads 1. A build that resolves contact before hits and deaths,
// or lets a dead enemy hit, reads 95.
//
// TOLERANCE. `REAL_EPS` on `hp`, one stated real with no recovery term
// (`BASE_RECOVERY` is 0 and nothing is held); the kill count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { BASE_MAX_HP, REAL_EPS } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enable,
  enemyById,
  isolate,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the moth stands: 5 units out, overlapping the lamplighter's circle. */
const MOTH_X = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves hp untouched when the overlapping moth dies to a bolt on the same tick", async () => {
  isolate(h);
  const moth = placeEnemy(h, "moth", MOTH_X, 0);
  placeProjectile(h, "ember", MOTH_X, 0, 0, 0, 0);
  enable(h, "enemyContact");

  const after = await advanceTicks(h, 1);
  captureStill(h, "no-hit");

  assertEqual(
    enemyById(after, moth),
    undefined,
    "the moth after the tick that killed it",
  );
  assertEqual(after.run.kills, 1, "kills after the tick");
  assertNear(
    after.run.player.hp,
    BASE_MAX_HP,
    REAL_EPS,
    "hp after the tick the overlapping moth died on",
  );
});
