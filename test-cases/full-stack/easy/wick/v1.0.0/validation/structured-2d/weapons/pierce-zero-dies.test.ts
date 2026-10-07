// weapons/pierce-zero-dies — a projectile with pierce 0 is removed by its
// first hit.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "Every hit
// lowers its `pierce` by one, and a hit on a projectile whose `pierce` is `0`
// removes it instead, so a projectile with `pierce` `n` hits `n + 1` enemies."
// So a bolt posed with pierce `0` hits one enemy and is gone from
// `projectiles` in the snapshot of that tick.
//
// THE POSE. One moth at `(200, 0)` and an Ember bolt posed at its center with
// zero velocity and pierce `0`: "a posed ... projectile ... first hits ... on
// the next tick" (`specs/instrumentation.md`), and the bolt's radius `8` and
// the moth's `10` overlap at distance `0`. Its `ttl` is the level-1 row's `2.0`
// seconds, so nothing but the hit can remove it on the first tick.
// `effectMotion` is held so the bolt stays on the moth while "hits still
// resolve"; nothing else runs.
//
// WHAT IS READ. That the hit landed, read off the moth, gone or with its hp
// lowered, and that the bolt is gone. A build that removes a posed bolt for
// some other reason on its first tick shows the same absence, so the hit is
// read beside it.
//
// THE TOLERANCE. None: presence in a list.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertTrue, assertUndefined } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the moth stands: clear of the lamplighter. */
const MOTH = { x: 200, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a pierce-0 bolt on the tick of its first hit", async () => {
  isolate(h);
  const moth = placeEnemyNear(h, "moth", MOTH.x, MOTH.y);
  const before = enemyById(h.snapshot(), moth);
  if (before === undefined) throw new Error("the posed moth is missing");
  const bolt = placeProjectile(h, "ember", before.x, before.y, 0, 0, 0);
  assertDefined(
    projectileById(h.snapshot(), bolt),
    "the posed bolt in projectiles before its first tick (specs/instrumentation.md, spawnProjectile)",
  );

  const struck = await advanceTicks(h, 1);
  captureStill(h, "spent");

  const after = enemyById(struck, moth);
  assertTrue(
    after === undefined || after.hp < before.hp,
    "the moth hit on the bolt's first tick, gone or with its hp lowered (specs/weapons.md, Hits and death)",
  );
  assertUndefined(
    projectileById(struck, bolt),
    "the pierce-0 bolt in projectiles on the tick of its first hit (specs/weapons.md, Projectiles and pierce)",
  );
});
