// clock/projectile-at-center-on-fire-tick — a projectile fired on a tick sits
// at the lamplighter's center for that tick, hits there, and first moves on
// the next.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick"), phase 6: "Then
// every projectile and zone hits, this tick's new ones included, a new one
// hitting at the position it was created at and first moving on the next
// tick". specs/weapons.md ("Ember"): "A bolt is a circle of `radius`, fired
// from the player's center at `speed` in the direction of the nearest enemy's
// center on the tick of firing"; and ("Projectiles and pierce"): "A projectile
// is a circle that moves at a constant velocity from the tick after it is
// fired ... On each tick it moves, its position advances by its velocity times
// `TICK_DT`", "Every hit lowers its `pierce` by one, and a hit on a projectile
// whose `pierce` is `0` removes it instead", and "A projectile with finite
// pierce hits a given enemy at most once". The hit itself is ("Hits and
// death"): "A hit removes the shape's damage per hit from the enemy's `hp`".
//
// THE DRIVE. Ember at level 5, whose row (`EMBER_LEVELS`) carries pierce `1`,
// so the bolt survives its hit and can be watched moving. A beetle fifteen
// units right of the lamplighter: within the bolt's `8` plus the beetle's
// `14`, so a bolt at the center overlaps it on the firing tick, and with
// `25` health against the row's `15` damage it survives to be read. On the
// firing tick the bolt is at the lamplighter's center and the beetle is down
// one hit; on the next the bolt is one step of `speed × TICK_DT` along the
// direction to the beetle, `+x`, and the beetle, hit once already by this
// bolt, is not hit again.
//
// THE NIGHT. An isolated run with the beetle alone and `effectMotion` on, so
// the bolt moves on the tick after; `enemyMotion` and `enemyContact` held, so
// the beetle stays where it is posed and lands no hit of its own.
//
// THE TOLERANCE. `POSITION_TOL` on the positions, `FLOAT_TOL` on the health
// taken. The figure that separates a bolt that sat from one that moved on its
// firing tick is the step, `6.667` units.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, TICK_DT, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  enable,
  fireWeapon,
  isolate,
  mustEnemy,
  mustProjectile,
  placeEnemyNear,
  player,
  unitToward,
  type Harness,
} from "../harness";

/** The Ember level fired: row 5 carries pierce 1. */
const EMBER_LEVEL = 5;

/** The beetle's center, fifteen units right of the lamplighter's. */
const BEETLE_DX = 15;

/** Ember's row at that level: damage `15`, speed `400`, pierce `1`. */
const ROW = weaponRow("ember", EMBER_LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the bolt at the center on its firing tick, hits there, and moves it on the next", async () => {
  await isolate(h);
  await enable(h, "effectMotion");
  const beetle = await placeEnemyNear(h, "beetle", BEETLE_DX, 0);
  const { firing, moved } = await captureReplay(h, "fired", async () => {
    const firing = await fireWeapon(h, "ember", EMBER_LEVEL);
    const moved = await h.step(1);
    return { firing, moved };
  });

  assertEqual(
    firing.projectiles.length,
    1,
    "bolts Ember created on its firing tick",
  );
  const bolt = firing.projectiles[0]!;
  const at = player(firing.after);
  assertNear(
    bolt.x,
    at.x,
    POSITION_TOL,
    "the bolt's x on its firing tick, against the lamplighter's center",
  );
  assertNear(
    bolt.y,
    at.y,
    POSITION_TOL,
    "the bolt's y on its firing tick, against the lamplighter's center",
  );
  assertNear(
    mustEnemy(firing.after, beetle.id).hp,
    beetle.hp - ROW.damage,
    FLOAT_TOL,
    "the beetle's hp on the firing tick: hit by the bolt at the center",
  );

  const direction = unitToward(at, beetle) ?? { x: 1, y: 0 };
  const later = mustProjectile(moved, bolt.id);
  assertNear(
    later.x,
    at.x + direction.x * (ROW.speed ?? NaN) * TICK_DT,
    POSITION_TOL,
    "the bolt's x on the tick after firing: one step along its velocity",
  );
  assertNear(
    later.y,
    at.y + direction.y * (ROW.speed ?? NaN) * TICK_DT,
    POSITION_TOL,
    "the bolt's y on the tick after firing: one step along its velocity",
  );
  assertNear(
    mustEnemy(moved, beetle.id).hp,
    beetle.hp - ROW.damage,
    FLOAT_TOL,
    "the beetle's hp on the tick after: hit once by this bolt, not again",
  );
});
