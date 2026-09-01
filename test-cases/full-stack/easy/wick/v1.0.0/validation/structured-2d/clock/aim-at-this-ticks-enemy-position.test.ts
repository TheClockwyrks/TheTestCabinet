// Wick — clock/aim-at-this-ticks-enemy-position: a weapon aims at the
// enemies' positions of this tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 4, "Every enemy ages by `TICK_DT`,
//     and, while `enemyMotion` is on, moves", comes before phase 5, "each
//     weapon whose timer is due fires, creating its projectiles and zones at
//     the lamplighter's and the enemies' positions of this tick."
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired
//     from the player's center at `speed` in the direction of the nearest
//     enemy's center on the tick of firing." Level 1: speed 400.
//   - `specs/weapons.md` ("The nearest enemy"): "A direction toward an enemy
//     is the unit vector from the player's center to the enemy's center".
//   - `specs/enemies.md` ("Drift"): "A drifting enemy keeps the heading it
//     spawned with for its whole life and advances one step along it every
//     tick", and `specs/instrumentation.md` (`setEnemyHeading`): "A chaser or
//     weaver recomputes its heading on its next move, so this poses a
//     drifter." A gnat drifts at 160.
//
// WHY A DRIFTER AND NOT A CHASER. A chaser's step is along the line from its
// center to the lamplighter's, so the direction from the lamplighter to its
// center before the step and after it is the SAME direction, and a bolt aimed
// at either would carry the same velocity. The requirement is only decidable
// against an enemy whose step changes its bearing, which a posed drift
// heading across the line of sight does: the gnat starts 300 units out along
// +x and steps `160 × TICK_DT` along +y on the firing tick.
//
// THE DRIVE. An isolated run, Ember at level 1 armed, `enemyMotion` on so
// the gnat steps, every other switch off. On the firing tick the gnat steps
// first and Ember fires after, so the bolt's velocity is `speed` along the
// unit vector from the lamplighter's center to the gnat's center AS THAT
// TICK'S SNAPSHOT REPORTS IT, after the step; aimed at the center the tick
// began at, the velocity would be `(400, 0)`, 3.5 units/s apart in `vy`.
//
// TOLERANCE. `MOTION_EPS` on each velocity component: a unit vector scaled by
// a stated speed, rounded by ulps, read against the reported center the same
// way.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertNear,
  assertPointNear,
} from "../assert";
import { EMBER_LEVELS, ENEMIES, MOTION_EPS, TICK_DT } from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureStill,
  createHarness,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemy,
  unit,
  type Harness,
} from "../harness";

/** Ember's level 1 bolt speed. */
const BOLT_SPEED = EMBER_LEVELS[0].speed;

/** Where the gnat starts, and the step it takes across the line of sight. */
const GNAT_X = 300;
const GNAT_STEP = ENEMIES.gnat.speed * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("aims the bolt at the gnat's center after its move on the firing tick", async () => {
  isolate(h);
  const gnat = placeEnemy(h, "gnat", GNAT_X, 0);
  h.debug.setEnemyHeading(gnat, 0, 1);
  const ember = holdWeapon(h, "ember", 1);
  enable(h, "enemyMotion");
  armWeapon(h, ember);

  const fired = await advanceTicks(h, 1);
  captureStill(h, "aimed");

  const moved = enemyById(fired, gnat);
  assertDefined(moved, "the gnat alive on the firing tick");
  assertPointNear(
    moved ?? { x: Number.NaN, y: Number.NaN },
    { x: GNAT_X, y: GNAT_STEP },
    MOTION_EPS,
    "the gnat's center after its step on the firing tick",
  );
  assertEqual(fired.run.projectiles.length, 1, "the bolts Ember fired");
  const bolt = fired.run.projectiles[0];
  const toward = unit(
    (moved?.x ?? Number.NaN) - fired.run.player.x,
    (moved?.y ?? Number.NaN) - fired.run.player.y,
  );
  assertNear(
    bolt.vx,
    BOLT_SPEED * toward.x,
    MOTION_EPS,
    "the bolt's vx, against speed along the unit vector to the moved gnat",
  );
  assertNear(
    bolt.vy,
    BOLT_SPEED * toward.y,
    MOTION_EPS,
    "the bolt's vy, against speed along the unit vector to the moved gnat",
  );
});
