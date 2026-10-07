// Wick — clock/projectile-at-center-on-fire-tick: a projectile fired on a tick
// sits at the lamplighter's center that tick, hits there, and first moves on
// the next.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/world.md` ("One tick"), phase 6: "Then every projectile and zone
//     hits, this tick's new ones included, a new one hitting at the position it
//     was created at and first moving on the next tick".
//   - `specs/weapons.md` ("Ember"): "A bolt is a circle of `radius`, fired from
//     the player's center at `speed` in the direction of the nearest enemy's
//     center on the tick of firing"; level 5 has damage `15`, speed `400`,
//     radius `8`, pierce `1`; ("Projectiles and pierce"): "A projectile is a
//     circle that moves at a constant velocity from the tick after it is
//     fired ... On each tick it moves, its position advances by its velocity
//     times `TICK_DT`", and "a hit on a projectile whose `pierce` is `0`
//     removes it", so a pierce of `1` survives its first hit.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii";
//     ("Hits and death"): "A hit removes the shape's damage per hit from the
//     enemy's `hp`."
//   - `specs/enemies.md`: a beetle has HP `25` and radius `14`, so a 15-damage
//     hit leaves it alive.
//
// WHAT IS READ. Ember at level 5 is held with `weaponFire` on and a beetle
// posed 4 units from the lamplighter's center, so the bolt fired on the first
// tick is created at the center, overlaps the beetle there, and hits it. Tick
// 1's snapshot must hold the bolt exactly at the lamplighter's center and the
// beetle down by the bolt's damage. Tick 2's snapshot must hold the bolt one
// step along its velocity, `400 × TICK_DT` from the center: the move that was
// deferred to the tick after firing.
//
// WHY THE NIGHT IS POSED AS IT IS. Level 5 is the lowest Ember level whose
// bolt survives a hit, so the bolt is still there on tick 2 to be read.
// `effectMotion` is on so the deferred move is observable; `enemyMotion` and
// `enemyContact` are off so the beetle neither moves nor hits back, and the
// lamplighter stands still, so the center the bolt is read against is fixed.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on the two positions and
// `FIGURE_TOLERANCE` (1e-9) on the beetle's health, a stated figure less a
// stated product.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import {
  EMBER_LEVELS,
  ENEMIES,
  FIGURE_TOLERANCE,
  MOTION_TOLERANCE,
  TICK_DT,
} from "../constants";
import {
  captureReplay,
  createHarness,
  distance,
  enable,
  enemyById,
  holdWeapon,
  isolate,
  projectileById,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The lowest Ember level whose bolt has pierce 1 and so survives one hit. */
const EMBER_LEVEL = 5;
const EMBER = EMBER_LEVELS[EMBER_LEVEL - 1];

/** The beetle's offset: inside the bolt's 8 plus its own 14, so they overlap. */
const BEETLE_DX = 4;

/** Ticks recorded after the reading, so the evidence shows the bolt flying. */
const AFTERMATH_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates the bolt at the center, hits there, and moves it on the next tick", async () => {
  isolate(h);
  const beetle = spawnEnemyNear(h, "beetle", BEETLE_DX, 0);
  holdWeapon(h, "ember", EMBER_LEVEL);
  enable(h, "weaponFire", "effectMotion");
  const idFloor = h.snapshot().run.nextId;

  const outcome = await captureReplay(h, "fired", async () => {
    const fireTick = await h.tick(1);
    const nextTick = await h.tick(1);
    await h.tick(AFTERMATH_TICKS);
    return { fireTick, nextTick };
  });

  const bolts = outcome.fireTick.run.projectiles.filter(
    (projectile) => projectile.weapon === "ember" && projectile.id >= idFloor,
  );
  assertEqual(bolts.length, 1, "Ember bolts on the firing tick");
  const bolt = bolts[0];
  const center = outcome.fireTick.run.player;
  assertWithin(
    distance(bolt, center),
    0,
    MOTION_TOLERANCE,
    "the bolt's distance from the lamplighter's center on the firing tick",
  );
  assertWithin(
    enemyById(outcome.fireTick, beetle)?.hp ?? Number.NaN,
    ENEMIES.beetle.hp - EMBER.damage,
    FIGURE_TOLERANCE,
    "the beetle's hp on the firing tick",
  );

  const flown = projectileById(outcome.nextTick, bolt.id);
  assertEqual(
    flown !== undefined,
    true,
    "the bolt still in flight a tick later",
  );
  assertWithin(
    distance(flown ?? bolt, outcome.nextTick.run.player),
    EMBER.speed * TICK_DT,
    MOTION_TOLERANCE,
    "the bolt's distance from the center on the tick after firing",
  );
});
