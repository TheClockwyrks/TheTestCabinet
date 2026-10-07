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
//     0)` makes that the next tick"; `setWeaponFire(on)` holds the firing
//     faculty while the lamplighter walks.
//   - `specs/controls.md`: `right` is bound to `ArrowRight` and `KeyD`;
//     `specs/world.md` ("The lamplighter"): the lamplighter walks at
//     `MOVE_SPEED` (`180`) units per second in the held direction, over a
//     world that is "an unbounded plane".
//
// WHAT IS READ. The lamplighter's `x` after the walk, above `2 × OIL_SCATTER`
// (800), so the reading below is taken from a place the run's origin is not.
// Then twenty firings, each made due by posing the timer to 0 and running one
// tick, and for each puddle the firing tick created the distance from its
// center to the lamplighter's center on that tick: at most 400 for every one
// of them. A build scattering over a larger disk puts a puddle beyond the
// bound within a few firings, and a build scattering about the run's origin,
// the view's center, or any other fixed point puts every puddle at least 800 −
// 400 = 400 away and fails on the first firing.
//
// WHY THE LAMPLIGHTER WALKS FIRST. The bound is measured from THE
// LAMPLIGHTER'S center, and a night posed by `isolate` stands the lamplighter
// on the run's origin, where the two candidate centers coincide and the
// reading cannot tell them apart. So `right` is held for 300 ticks with
// `weaponFire` off — 5 seconds at `MOVE_SPEED` (180), 900 units, more than
// twice the scatter radius — and the walk's arrival is asserted before a
// single firing is sampled. `weaponFire` goes back on for the firings.
//
// WHY THE NIGHT IS POSED AS IT IS. Oil Splash alone at level 1 on an empty
// field, every switch off but `weaponFire`: Oil Splash needs no target, so no
// enemy is posed, and no key is held during the sampled firings, so every one
// of them is about the same center. The zones are cleared between firings so
// each tick's puddles are the only ones in the world.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) beyond the bound: the distance is the
// product of two stated figures read back through the build's own
// trigonometry. None on the count of firings, and none on the walk's arrival,
// which is asserted as a strict inequality far inside the distance a
// conformant walk covers.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { FIGURE_TOLERANCE, OIL_SCATTER } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  distance,
  enable,
  hold,
  keysOf,
  type Harness,
} from "../harness";
import { armOilSplash, fireOnce } from "./puddle";

/** The level held: any row serves, and row 1 is the acquisition row. */
const LEVEL = 1;

/** How many firings are sampled. */
const FIRINGS = 20;

/**
 * How long `right` is held before the first sampled firing: 300 ticks, 5
 * seconds at `MOVE_SPEED` (180), carrying the lamplighter 900 units east of
 * the run's origin.
 */
const WALK_TICKS = 300;

/**
 * How far from the run's origin the walk must have carried the lamplighter
 * before a firing is sampled: twice the scatter radius, so no disk of radius
 * `OIL_SCATTER` about the origin reaches the lamplighter's own disk.
 */
const WALK_CLEARANCE = 2 * OIL_SCATTER;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands every puddle of twenty firings within 400 of the lamplighter", async () => {
  const { slot } = armOilSplash(h, LEVEL);

  disable(h, "weaponFire");
  const walked = await hold(h, keysOf("right")[0], WALK_TICKS);
  enable(h, "weaponFire");
  assertGreaterThan(
    walked.run.player.x,
    WALK_CLEARANCE,
    "the lamplighter's x after the walk, clear of the run's origin",
  );

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
