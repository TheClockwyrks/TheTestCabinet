// Wick — weapons/pierce-zero-dies: a projectile with pierce 0 is removed by
// its first hit.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "Every hit lowers its
//     `pierce` by one, and a hit on a projectile whose `pierce` is `0` removes
//     it instead, so a projectile with `pierce` `n` hits `n + 1` enemies."
//   - `specs/state.md` (`ProjectileState.pierce`): "a projectile at `0` is
//     removed by the hit that would take it lower".
//   - `specs/instrumentation.md` (`spawnProjectile`): `pierce` is posed, and a
//     posed projectile "first hits ... on the next tick".
//   - `specs/weapons.md` ("Shapes and overlap"): two circles overlap when their
//     centers are closer than the sum of their radii, so a bolt posed on the
//     moth's center overlaps it.
//
// WHAT IS READ. The snapshot after the one tick on which the posed bolt hits
// the moth: the bolt is gone from `projectiles`. The moth's absence is read
// first as the evidence the hit landed, so a bolt that vanished for some other
// reason is told from one spent by a hit; its ttl of 2 seconds is nowhere near
// due on that tick.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and one bolt on its center, 150
// units from the lamplighter, every switch off: hits resolve whatever the
// switches hold, and nothing else is in the world to hit or be hit.
//
// TOLERANCE. None: the bolt is either in `projectiles` after the tick or not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

/** Where the moth stands: along +x, clear of the lamplighter. */
const MOTH_DX = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes a pierce-0 bolt on the tick of its first hit", async () => {
  isolate(h);
  const moth = spawnEnemyNear(h, "moth", MOTH_DX, 0);
  const placed = present(enemyById(h.snapshot(), moth), "the posed moth");
  const bolt = spawnProjectileAt(h, "ember", placed.x, placed.y, 0, 0, 0);
  assertEqual(
    projectileById(h.snapshot(), bolt)?.pierce,
    0,
    "the bolt's pierce as posed",
  );

  const after = await h.tick(1);
  captureStill(h, "spent");

  assertEqual(enemyById(after, moth), undefined, "the moth the bolt hit");
  assertEqual(projectileById(after, bolt), undefined, "the bolt after its hit");
});
