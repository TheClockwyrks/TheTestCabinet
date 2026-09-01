// Wick — oil-splash/scatter-within-radius: every puddle lands within
// `OIL_SCATTER` of the lamplighter's center.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Oil Splash"): "On firing, `amount` puddles appear,
//     each centered at an independent uniformly random point of the disk of
//     radius `OIL_SCATTER` (`400`) about the player's center: a distance
//     `OIL_SCATTER × sqrt(u)` at a uniformly random angle, with `u` uniform
//     on `[0, 1)`."
//   - `specs/weapons.md` ("Derived stats"): "`OIL_SCATTER`, `SPARK_RANGE`,
//     `PIN_SPREAD`, the spread angles, and the re-hit intervals are unchanged
//     by any passive."
//   - `specs/world.md` ("One tick"), phase 5: a due weapon fires "creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick".
//   - `specs/state.md` (`ZoneState`): "`x`, `y`: the center of the circle".
//   - `specs/instrumentation.md` (`setWeaponCooldown`): "`setWeaponCooldown(slot,
//     0)` makes that the next tick".
//
// WHAT IS READ. Twenty firings, each made due by posing the timer to 0 and
// running one tick, and for each puddle the firing tick created the distance
// from its center to the lamplighter's center on that tick: at most 400 for
// every one of them. A build scattering over a larger disk, or about a point
// other than the lamplighter, puts a puddle beyond the bound within a few
// firings; the twenty landing points of `u` uniform on `[0, 1)` are all at a
// distance below 400.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 1 on an empty
// field, every switch off but `weaponFire`: Oil Splash needs no target, so no
// enemy is posed, and no key is held, so the lamplighter stands still and
// every firing is about the same center. The zones are cleared between
// firings so each tick's puddles are the only ones in the world.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) beyond the bound: the distance is the
// product of two stated figures read back through the build's own
// trigonometry. None on the count of firings.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { FIGURE_TOLERANCE, OIL_SCATTER } from "../constants";
import {
  captureStill,
  createHarness,
  distance,
  type Harness,
} from "../harness";
import { armOilSplash, fireOnce } from "./puddle";

/** The level held: any row serves, and row 1 is the acquisition row. */
const LEVEL = 1;

/** How many firings are sampled. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands every puddle of twenty firings within 400 of the lamplighter", async () => {
  const { slot } = armOilSplash(h, LEVEL);

  for (let firing = 1; firing <= FIRINGS; firing += 1) {
    if (firing > 1) h.debug.clearZones();
    const { after, created } = await fireOnce(h, slot);
    if (firing === FIRINGS) captureStill(h, "scatter");
    assertGreaterThan(created.length, 0, `puddles created on firing ${firing}`);
    const center = { x: after.run.player.x, y: after.run.player.y };
    for (const puddle of created) {
      assertLessThanOrEqual(
        distance(puddle, center),
        OIL_SCATTER + FIGURE_TOLERANCE,
        `firing ${firing}, puddle ${puddle.id}: distance from the lamplighter's center`,
      );
    }
  }
});
