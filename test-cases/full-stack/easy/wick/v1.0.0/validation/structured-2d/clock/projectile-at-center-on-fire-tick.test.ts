// Wick — clock/projectile-at-center-on-fire-tick: a projectile fired on a
// tick sits at the lamplighter's center that tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired
//     from the player's center at `speed` in the direction of the nearest
//     enemy's center on the tick of firing."
//   - `specs/world.md` ("One tick", phase 6): "Then every projectile and zone
//     hits, this tick's new ones included, a new one hitting at the position
//     it was created at and first moving on the next tick".
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile is a circle
//     that moves at a constant velocity from the tick after it is fired ...
//     Every hit lowers its `pierce` by one, and a hit on a projectile whose
//     `pierce` is `0` removes it instead". Ember's level 5 row: damage 15,
//     speed 400, radius 8, pierce 1, amount 2.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when
//     the distance between their centers is less than the sum of their
//     radii."
//
// THE DRIVE. An isolated run, Ember at level 5 armed, `effectMotion` on so a
// bolt that may move does, and one beetle (25 hp, radius 14) ten units to the
// right of the lamplighter. Ember at level 5 fires one bolt per enemy, so one
// bolt; its pierce of 1 is what lets the bolt survive the hit it lands on its
// firing tick, and the beetle's 25 hp is what lets the beetle survive the 15
// it takes. On the firing tick the bolt reads at the lamplighter's center,
// and the beetle has taken the hit, because the bolt hit "at the position it
// was created at": a bolt whose center is at the origin with radius 8 is
// within 8 + 14 of a beetle at (10, 0). On the next tick the bolt has taken
// its first step, `400 × TICK_DT` along +x, the direction of the beetle.
//
// TOLERANCE. `REAL_EPS` on the firing tick's position and on the beetle's hp,
// stated reals; `MOTION_EPS` on the next tick's position, one integration
// step.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDefined,
  assertEqual,
  assertNear,
  assertPointNear,
} from "../assert";
import {
  EMBER_LEVELS,
  ENEMIES,
  MOTION_EPS,
  REAL_EPS,
  TICK_DT,
} from "../constants";
import {
  advanceTicks,
  armWeapon,
  captureReplay,
  createHarness,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  placeEnemy,
  projectileById,
  type Harness,
} from "../harness";

/** The Ember level whose bolt survives one hit: pierce 1. */
const EMBER_LEVEL = 5;
const EMBER_ROW = EMBER_LEVELS[EMBER_LEVEL - 1];

/** Where the beetle stands: overlapping a bolt at the origin, along +x. */
const BEETLE_X = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the bolt at the lamplighter's center, hits there on that tick, and moves it on the next", async () => {
  isolate(h);
  const beetle = placeEnemy(h, "beetle", BEETLE_X, 0);
  const ember = holdWeapon(h, "ember", EMBER_LEVEL);
  enable(h, "effectMotion");
  armWeapon(h, ember);
  const before = h.snapshot();
  const boltId = before.run.nextId;

  const fired = await captureReplay(h, "fired", async () => {
    const onFireTick = await advanceTicks(h, 1);
    const nextTick = await advanceTicks(h, 1);
    return { onFireTick, nextTick };
  });

  assertEqual(
    fired.onFireTick.run.projectiles.length,
    1,
    "the bolts Ember fired on the firing tick",
  );
  const bolt = projectileById(fired.onFireTick, boltId);
  assertDefined(bolt, "the bolt, under the next id, on its firing tick");
  assertPointNear(
    bolt ?? { x: Number.NaN, y: Number.NaN },
    fired.onFireTick.run.player,
    REAL_EPS,
    "the bolt's center on its firing tick, against the lamplighter's center",
  );
  assertNear(
    enemyById(fired.onFireTick, beetle)?.hp ?? Number.NaN,
    ENEMIES.beetle.hp - EMBER_ROW.damage,
    REAL_EPS,
    "the beetle's hp on the firing tick, hit by the bolt at its center",
  );

  const moved = projectileById(fired.nextTick, boltId);
  assertDefined(moved, "the bolt still in flight on the next tick");
  assertPointNear(
    moved ?? { x: Number.NaN, y: Number.NaN },
    {
      x: fired.onFireTick.run.player.x + EMBER_ROW.speed * TICK_DT,
      y: fired.onFireTick.run.player.y,
    },
    MOTION_EPS,
    "the bolt's center on tick n + 1, one step along +x",
  );
});
