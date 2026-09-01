// Wick — clock/aim-at-this-ticks-enemy-position: a weapon aims at the enemies'
// positions of this tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"): phase 4, "Every enemy ages by `TICK_DT`,
//     and, while `enemyMotion` is on, moves as `specs/enemies.md` states",
//     comes before phase 5, "each weapon whose timer is due fires, creating its
//     projectiles and zones at the lamplighter's and the enemies' positions of
//     this tick."
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired from
//     the player's center at `speed` in the direction of the nearest enemy's
//     center on the tick of firing"; ("The nearest enemy"): "A direction
//     toward an enemy is the unit vector from the player's center to the
//     enemy's center".
//   - `specs/enemies.md` ("Drift"): "A drifting enemy keeps the heading it
//     spawned with for its whole life and advances one step along it every
//     tick", a gnat's speed being `160`; `specs/instrumentation.md`
//     (`setEnemyHeading`): "A chaser or weaver recomputes its heading on its
//     next move, so this poses a drifter."
//
// WHAT IS READ. Ember is held with `weaponFire` and `enemyMotion` on, and a
// gnat is posed 300 units to the right with its heading straight down. The
// first tick moves the gnat `160 × TICK_DT` downward and then fires the bolt,
// so the bolt's velocity must point at the gnat's center after that move, at
// (300, 2.667), and not along the +x axis it started on. The gnat's move is
// asserted first, so the bearing is read against a position that did change.
//
// WHY A DRIFTER AND NOT A CHASER. A chaser moves straight toward the
// lamplighter, so with the lamplighter still its move leaves its bearing from
// the center unchanged and the two candidate aims coincide; only an enemy
// whose move changes its bearing can decide this point, and a posed heading
// on a drifter is the one move the surface fixes exactly.
//
// WHY THE NIGHT IS POSED AS IT IS. One enemy, so it is the nearest; the
// lamplighter still, so the bearing changes by the gnat's move alone;
// `enemyContact` off, so the far gnat is never a hit in any case; nothing else
// held or moving.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the gnat's moved position;
// `DIRECTION_TOLERANCE` (1e-9) on each component of the bolt's unit velocity,
// a quotient of exact figures. The bearing the tick began on differs from the
// moved one by about 9e-3 in the y component, four orders above it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  DIRECTION_TOLERANCE,
  ENEMIES,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  spawnEnemyNear,
  unit,
  type Harness,
} from "../harness";

/** Where the gnat starts: straight right of the lamplighter, well clear. */
const GNAT_DX = 300;

/** The gnat's posed heading: straight down, across the bearing it began on. */
const GNAT_HEADING = { x: 0, y: 1 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("points the bolt at the gnat's center after its move on the firing tick", async () => {
  const posed = isolate(h);
  const gnat = spawnEnemyNear(h, "gnat", GNAT_DX, 0);
  h.debug.setEnemyHeading(gnat, GNAT_HEADING.x, GNAT_HEADING.y);
  holdWeapon(h, "ember");
  enable(h, "enemyMotion", "weaponFire");
  const idFloor = h.snapshot().run.nextId;

  const after = await h.tick(1);
  captureStill(h, "aimed");

  const moved = enemyById(after, gnat);
  assertEqual(moved !== undefined, true, "the gnat alive after the tick");
  assertWithin(
    moved?.x ?? Number.NaN,
    posed.run.player.x + GNAT_DX,
    MOTION_TOLERANCE,
    "the gnat's x after its move",
  );
  assertWithin(
    moved?.y ?? Number.NaN,
    posed.run.player.y + ENEMIES.gnat.speed * TICK_DT,
    MOTION_TOLERANCE,
    "the gnat's y after its move",
  );

  const bolts = after.run.projectiles.filter(
    (projectile) => projectile.weapon === "ember" && projectile.id >= idFloor,
  );
  assertEqual(bolts.length, 1, "Ember bolts on the firing tick");
  const aim = unit(bolts[0].vx, bolts[0].vy);
  const toMoved = unit(
    (moved?.x ?? Number.NaN) - after.run.player.x,
    (moved?.y ?? Number.NaN) - after.run.player.y,
  );
  assertWithin(
    aim.x,
    toMoved.x,
    DIRECTION_TOLERANCE,
    "the bolt's unit velocity, x, against the moved gnat",
  );
  assertWithin(
    aim.y,
    toMoved.y,
    DIRECTION_TOLERANCE,
    "the bolt's unit velocity, y, against the moved gnat",
  );
});
