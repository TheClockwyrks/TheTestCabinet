// weapons/pierce-counts-down — every hit lowers pierce by one.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "Every hit
// lowers its `pierce` by one, and a hit on a projectile whose `pierce` is `0`
// removes it instead, so a projectile with `pierce` `n` hits `n + 1`
// enemies." So a pin posed with pierce `2` reads `1` after one hit, and one
// laid across three enemies hits all three and is removed by the third: two
// hits take it to `0`, and the third is "a hit on a projectile whose `pierce`
// is `0`".
//
// WHY TWO READINGS, IN ONE POINT. The count-down is one rule read at two
// depths: the figure after one hit, and the removal after `n + 1`. A build
// that never lowers pierce fails the first; one that lowers it but removes the
// projectile at the wrong count fails the second.
//
// THE POSE. A pin posed at `(200, 0)` with zero velocity and pierce `2`, over
// one moth at the same point; then a fresh pin at the same point over three
// moths at `(188, 0)`, `(200, 0)`, and `(212, 0)`, each center `12` or less
// from the pin's, inside the `6 + 10` overlap bound. A posed projectile "first
// hits ... on the next tick" (`specs/instrumentation.md`), and "When one such
// projectile overlaps several enemies on the same tick, they are hit in
// ascending enemy `id` until the projectile is removed", so the three hits
// land on one tick. A pin's level-1 damage `6` kills a `5` hp moth, which is
// how the third hit is read: all three gone. `effectMotion` is held so each
// pin stays where it was posed; nothing else runs.
//
// THE TOLERANCE. None: an integer and a presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertUndefined } from "../assert";
import {
  advanceTicks,
  captureReplay,
  createHarness,
  isolate,
  placeEnemyNear,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the pins are posed. */
const PIN = { x: 200, y: 0 };

/** The pierce each pin is posed with. */
const PIERCE = 2;

/** The three moths' centers, each within `6 + 10` of the pin's. */
const ROW = [
  { x: 188, y: 0 },
  { x: 200, y: 0 },
  { x: 212, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads pierce 1 after one hit and is removed by the third of three", async () => {
  isolate(h);

  const counted = await captureReplay(h, "counted", async () => {
    // One hit.
    placeEnemyNear(h, "moth", PIN.x, PIN.y);
    const single = placeProjectile(h, "pin", PIN.x, PIN.y, 0, 0, PIERCE);
    const once = await advanceTicks(h, 1);
    const afterOne = projectileById(once, single)?.pierce;

    // Three hits on one tick.
    h.debug.clearEnemies();
    h.debug.clearProjectiles();
    const moths = ROW.map((at) => placeEnemyNear(h, "moth", at.x, at.y));
    const across = placeProjectile(h, "pin", PIN.x, PIN.y, 0, 0, PIERCE);
    const thrice = await advanceTicks(h, 1);
    return {
      afterOne,
      survivors: thrice.run.enemies
        .filter((enemy) => moths.includes(enemy.id))
        .map((enemy) => enemy.id),
      spent: projectileById(thrice, across),
    };
  });

  assertEqual(
    counted.afterOne,
    PIERCE - 1,
    "the pin's pierce after one hit from 2 (specs/weapons.md, Projectiles and pierce)",
  );
  assertDeepEqual(
    counted.survivors,
    [],
    "the three moths still alive after the pierce-2 pin's tick, all three hit (specs/weapons.md, Projectiles and pierce)",
  );
  assertUndefined(
    counted.spent,
    "the pierce-2 pin in projectiles after its third hit (specs/weapons.md, Projectiles and pierce)",
  );
});
