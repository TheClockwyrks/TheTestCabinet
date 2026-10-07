// Wick — halo/pulse-hits-overlapping: a pulse hits every enemy whose circle
// overlaps the aura, and none whose circle does not.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "every enemy whose circle overlaps the aura
//     takes `damage`"; level 1 has damage `3` and radius `80`.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii", and
//     "An enemy is a circle of its own radius"; a moth has radius `10` and HP
//     `5` (`specs/enemies.md`), so the sum is 90.
//   - `specs/weapons.md` ("Halo"): the aura is "centered on the player's
//     center every tick", so an enemy's distance from the aura's center is its
//     distance from the lamplighter's.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on, so the pulse is posed onto tick 1.
//
// WHAT IS READ. Two moths after the first tick, the pulse tick: the one whose
// center is 85 units from the lamplighter's reads 5 − 3 = 2, and the one at
// 95 units reads 5 untouched. 85 is inside the sum of 90 and 95 is outside it,
// each by 5 units, so a build reading the aura's radius alone, without the
// enemy's, spares the first, and one hitting by a looser test strikes the
// second.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 1 and two moths on the
// x axis, one at +85 and one at −95, so each distance is an exact double and
// no rounding of the build's own can carry a moth across the boundary. The
// timer is posed to 0 and every switch is off but `weaponFire`, so the pulse
// lands on the first tick, nothing moves either moth, and the pulse is the
// only thing that can change them.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each hp: stated figures and their exact
// difference, read back as doubles.

import { afterEach, beforeEach, it } from "vitest";
import { ENEMIES } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  spawnEnemyNear,
  type Harness,
} from "../harness";
import {
  PROBE,
  assertProbeTook,
  assertProbeUnhurt,
  haloRow,
  poseHalo,
} from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 1;

/** Row 1 of HALO_LEVELS: damage 3, radius 80. */
const ROW = haloRow(LEVEL);

/** The radii's sum: the boundary the overlap rule is strict at. */
const BOUNDARY = ROW.radius + ENEMIES[PROBE].radius;

/** Center distance of the moth the pulse hits: 5 units inside the boundary. */
const INSIDE = BOUNDARY - 5;

/** Center distance of the moth the pulse spares: 5 units outside it. */
const OUTSIDE = BOUNDARY + 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits a moth at 85 units on the pulse and spares one at 95", async () => {
  const { slot } = poseHalo(h, LEVEL, null);
  const inside = spawnEnemyNear(h, PROBE, INSIDE, 0);
  const outside = spawnEnemyNear(h, PROBE, -OUTSIDE, 0);
  const posed = h.snapshot();
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "overlap");

  assertProbeTook(
    posed,
    after,
    inside,
    ROW.damage,
    `the moth at ${INSIDE} units after the pulse`,
  );
  assertProbeUnhurt(
    posed,
    after,
    outside,
    `the moth at ${OUTSIDE} units after the pulse`,
  );
});
