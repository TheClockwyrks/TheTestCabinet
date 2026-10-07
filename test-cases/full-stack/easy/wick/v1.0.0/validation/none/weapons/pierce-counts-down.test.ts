// Wick — weapons/pierce-counts-down: every hit lowers pierce by one.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "Every hit lowers its `pierce` by one, and a hit on a projectile
// whose `pierce` is `0` removes it instead, so a projectile with `pierce` `n`
// hits `n + 1` enemies." And: "When one such projectile overlaps several
// enemies on the same tick, they are hit in ascending enemy `id` until the
// projectile is removed." So a pin with pierce `2` reads `1` after one hit,
// and laid across three moths it hits all three — `2`, `1`, `0`, removed — on
// one tick.
//
// THE POSE. Two halves, each on a fresh isolated night. First, one moth and a
// pin posed on its center with zero velocity and pierce `2`; the next tick's
// hit leaves the pin with pierce `1`. Then three moths inside one pin's
// circle — a pin's level-1 radius is `6` and a moth's is `10`, so a moth
// `10` above and one `10` below the pin's center are both within the `16`
// that "Two circles overlap when the distance between their centers is less
// than the sum of their radii" needs — and the next tick hits all three and
// removes the pin. A pin's `6` damage takes each moth's `5` hp below zero, so
// every hit is seen as a moth gone. Every faculty is held; the moths stand
// clear of the lamplighter.
//
// TOLERANCE. None: pierce is a whole number and the rest is presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, assertUndefined } from "../assert";
import { ENEMIES, weaponRow } from "../constants";
import {
  captureReplay,
  createHarness,
  enemyById,
  isolate,
  mustProjectile,
  placeEnemy,
  placeProjectile,
  projectileById,
  type Harness,
} from "../harness";

/** Where the pin lies, clear of the lamplighter. */
const PIN = { x: 200, y: 0 };

/** The pierce posed on each pin. */
const PIERCE = 2;

/**
 * How far above and below the pin's center the outer moths stand: inside the
 * `6 + 10` overlap distance, and far enough apart to read as three.
 */
const ROW_GAP = ENEMIES.moth.radius;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lowers a pin's pierce by one per hit and removes it on the hit past zero", async () => {
  // The overlap the pose relies on: `6 + 10` against a gap of `10`.
  assertTrue(
    ROW_GAP < weaponRow("pin", 1).radius! + ENEMIES.moth.radius,
    "the outer moths inside the pin's overlap distance",
  );

  const counted = await captureReplay(h, "counted", async () => {
    // One hit: pierce 2 reads 1.
    await isolate(h);
    const lone = await placeEnemy(h, "moth", PIN.x, PIN.y);
    const first = await placeProjectile(h, "pin", PIN.x, PIN.y, 0, 0, PIERCE);
    const oneHit = await h.step(1);
    const afterOne = {
      mothGone: enemyById(oneHit, lone.id) === undefined,
      pierce: mustProjectile(oneHit, first.id).pierce,
    };

    // Three hits on one tick: pierce 2, 1, 0, removed.
    await isolate(h);
    const row = [
      await placeEnemy(h, "moth", PIN.x, PIN.y - ROW_GAP),
      await placeEnemy(h, "moth", PIN.x, PIN.y),
      await placeEnemy(h, "moth", PIN.x, PIN.y + ROW_GAP),
    ];
    const second = await placeProjectile(h, "pin", PIN.x, PIN.y, 0, 0, PIERCE);
    const threeHits = await h.step(1);
    await h.step(12);
    return {
      afterOne,
      standing: row.filter(
        (moth) => enemyById(threeHits, moth.id) !== undefined,
      ).length,
      pinLeft: projectileById(threeHits, second.id),
    };
  });

  assertTrue(counted.afterOne.mothGone, "the lone moth gone after the hit");
  assertEqual(
    counted.afterOne.pierce,
    PIERCE - 1,
    "the pin's pierce after one hit",
  );
  assertEqual(
    counted.standing,
    0,
    "moths of the row still standing after the tick",
  );
  assertUndefined(counted.pinLeft, "the pin after its third hit");
});
