// Wick — weapons/pierce-counts-down: every hit lowers a projectile's pierce by
// one, and a projectile with pierce n hits n + 1 enemies.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Projectiles and pierce"): "Every hit lowers its
//     `pierce` by one, and a hit on a projectile whose `pierce` is `0` removes
//     it instead, so a projectile with `pierce` `n` hits `n + 1` enemies."
//   - `specs/weapons.md` ("Projectiles and pierce"): "When one such projectile
//     overlaps several enemies on the same tick, they are hit in ascending
//     enemy `id` until the projectile is removed."
//   - `specs/weapons.md` ("Pin"): level-1 damage `6`, radius `6`;
//     `specs/enemies.md`: a moth has HP `5`, radius `10`, so a dart overlaps a
//     moth whose center is within 16 units and each hit kills.
//   - `specs/instrumentation.md` (`spawnProjectile`): `pierce` is posed and a
//     posed projectile "first hits ... on the next tick".
//
// WHAT IS READ. Two scenes. A pin posed with pierce 2 on one moth reads pierce
// 1 after the tick of the hit. A pin posed with pierce 2 across three moths in
// a row hits all three on that tick, the third hit removing it: the three
// moths are gone and so is the pin.
//
// WHY THE NIGHT IS POSED AS IT IS. The moths and the pin alone, 150 units from
// the lamplighter, every switch off; the pin has zero velocity, so what it
// overlaps is what it was posed on. The row's moths sit 10 units apart along
// x, each within the 16 the radii sum to of the pin's center.
//
// TOLERANCE. None: pierce is a whole count and presence is a fact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ENEMIES, PIN_LEVELS } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** The pierce both pins are posed with: one hit lowers it, three spend it. */
const PIERCE = 2;

/** Where the scene stands: along +x, clear of the lamplighter. */
const DX = 150;

/** The spacing of the row's moths along x, inside the overlap of each. */
const ROW_STEP = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lowers pierce 2 to 1 on one hit, and spends it on the third of three", async () => {
  assertEqual(
    ROW_STEP < PIN_LEVELS[0].radius + ENEMIES.moth.radius,
    true,
    "the row's step is inside the dart's overlap with a moth",
  );

  const counted = await captureReplay(h, "counted", async () => {
    // One moth: the hit lowers pierce by one.
    isolate(h);
    const lone = spawnEnemyNear(h, "moth", DX, 0);
    const lonePlaced = present(enemyById(h.snapshot(), lone), "the lone moth");
    const single = spawnProjectileAt(
      h,
      "pin",
      lonePlaced.x,
      lonePlaced.y,
      0,
      0,
      PIERCE,
    );
    const afterOne = await h.tick(1);

    // Three moths in a row: three hits, the third removing the pin.
    isolate(h);
    const row = [-ROW_STEP, 0, ROW_STEP].map((step) =>
      spawnEnemyNear(h, "moth", DX + step, 0),
    );
    const middle = present(
      enemyById(h.snapshot(), row[1]),
      "the row's middle moth",
    );
    const triple = spawnProjectileAt(
      h,
      "pin",
      middle.x,
      middle.y,
      0,
      0,
      PIERCE,
    );
    const afterThree = await h.tick(1);
    return { lone, single, afterOne, row, triple, afterThree };
  });

  assertEqual(
    enemyById(counted.afterOne, counted.lone),
    undefined,
    "the lone moth after the hit",
  );
  assertEqual(
    projectileById(counted.afterOne, counted.single)?.pierce,
    PIERCE - 1,
    "the pin's pierce after one hit",
  );
  for (const moth of counted.row) {
    assertEqual(
      enemyById(counted.afterThree, moth),
      undefined,
      `moth ${moth} of the row after the tick`,
    );
  }
  assertEqual(
    projectileById(counted.afterThree, counted.triple),
    undefined,
    "the pin after its third hit",
  );
});
