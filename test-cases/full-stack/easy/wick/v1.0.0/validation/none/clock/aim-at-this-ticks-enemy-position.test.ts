// clock/aim-at-this-ticks-enemy-position — a weapon aims at the enemies'
// positions of this tick, after the enemies have moved.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick"): phase 4, "Every
// enemy ages by `TICK_DT`, and, while `enemyMotion` is on, moves as
// `specs/enemies.md` states", comes before phase 5, "each weapon whose timer
// is due fires, creating its projectiles and zones at the lamplighter's and
// the enemies' positions of this tick". specs/weapons.md ("Ember"): "A bolt is
// ... fired from the player's center at `speed` in the direction of the
// nearest enemy's center on the tick of firing", where ("The nearest enemy")
// "A direction toward an enemy is the unit vector from the player's center to
// the enemy's center".
//
// WHY A DRIFTER AND NOT A CHASER. A chaser's step is along the line from its
// center to the lamplighter's, so before and after its move it lies on the
// same ray from a lamplighter that stands still, and the two aims coincide.
// A drifter (specs/enemies.md, "Drift": "A drifting enemy keeps the heading
// it spawned with ... and advances one step along it every tick", posed by
// `setEnemyHeading`, which "poses a drifter") moves wherever its heading
// points. So a gnat two hundred units right of the lamplighter, heading
// straight down, is at `(200, 0)` when the tick begins and at
// `(200, 160 / 60)` when Ember fires: the aim at the moved center is `0.76`
// degrees below the aim at the old one.
//
// THE DRIVE. The gnat placed and headed, `enemyMotion` on, Ember held with
// its timer at `0`, `weaponFire` on, and the firing tick. The bolt's velocity
// points along the unit vector from the lamplighter's center to the gnat's
// center as that tick's snapshot reports it, after its move.
//
// THE NIGHT. An isolated run with the gnat alone, two hundred units away so
// the bolt at the center touches nothing. `enemyContact` and `effectMotion`
// held: neither a hit nor the bolt's own motion is what is read.
//
// THE TOLERANCE. `ANGLE_TOL`, the `1e-6` degrees allowed an angle recovered
// through `atan2`, on the bolt's velocity direction against the direction to
// the moved gnat; the aim at the unmoved gnat is `0.76` degrees away.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual, assertNear } from "../assert";
import { ANGLE_TOL, ENEMIES, POSITION_TOL, TICK_DT } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  mustEnemy,
  placeEnemy,
  player,
  type Harness,
} from "../harness";

/** The gnat's spawn point, two hundred units right of the lamplighter. */
const GNAT_X = 200;
const GNAT_Y = 0;

/** The heading posed on it: straight down, across the line of aim. */
const HEADING_X = 0;
const HEADING_Y = 1;

/** The origin, for reading a velocity's direction as an angle. */
const ORIGIN = { x: 0, y: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("aims the bolt at the gnat's center after its move on the firing tick", async () => {
  await isolate(h, { on: ["enemyMotion"] });
  const gnat = await placeEnemy(h, "gnat", GNAT_X, GNAT_Y);
  await h.debug.setEnemyHeading(gnat.id, HEADING_X, HEADING_Y);
  const firing = await fireWeapon(h, "ember");
  await captureStill(h, "aimed");

  const moved = mustEnemy(firing.after, gnat.id);
  assertNear(
    moved.y,
    GNAT_Y + HEADING_Y * ENEMIES.gnat.speed * TICK_DT,
    POSITION_TOL,
    "the gnat's y after its drift step on the firing tick",
  );
  assertEqual(
    firing.projectiles.length,
    1,
    "bolts Ember created on its firing tick",
  );
  const bolt = firing.projectiles[0]!;
  assertAngleNear(
    angleFrom(ORIGIN, { x: bolt.vx, y: bolt.vy }),
    angleFrom(player(firing.after), moved),
    ANGLE_TOL,
    "the bolt's velocity direction, against the direction to the gnat's center after its move",
  );
});
