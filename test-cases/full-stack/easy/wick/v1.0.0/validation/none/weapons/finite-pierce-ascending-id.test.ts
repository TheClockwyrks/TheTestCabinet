// Wick — weapons/finite-pierce-ascending-id: a finite-pierce projectile hits
// overlapping enemies in ascending id.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Projectiles and
// pierce"): "When one such projectile overlaps several enemies on the same
// tick, they are hit in ascending enemy `id` until the projectile is removed."
// With pierce `1` a projectile "hits `n + 1`" = `2` enemies, so of three moths
// it overlaps on one tick the two with the lowest ids are hit and the third is
// untouched.
//
// THE POSE. Three moths inside one pin's circle, posed so that id order and
// distance order disagree: the two lower ids stand `10` above and below the
// pin's center and the highest id stands ON it. A build that hits the nearest
// first, or the last it iterated, hits the wrong two. A pin's level-1 radius
// is `6` and a moth's `10`, so every moth is within the `16` overlap
// distance. The pin's `6` damage takes each moth's `5` hp below zero, so each
// hit is seen as a moth gone, and the untouched moth still reads `5`. Every
// faculty is held; the moths stand clear of the lamplighter.
//
// TOLERANCE. None: presence and a posed hp that no hit reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue, assertUndefined } from "../assert";
import { ENEMIES, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  mustEnemy,
  placeEnemy,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the pin lies, clear of the lamplighter. */
const PIN = { x: 200, y: 0 };

/** The outer moths' offset from the center: inside the `6 + 10` overlap distance. */
const ROW_GAP = ENEMIES.moth.radius;

/** The pierce posed: two hits and no more. */
const PIERCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("hits the two lowest ids of three overlapping moths and leaves the third", async () => {
  assertTrue(
    ROW_GAP < weaponRow("pin", 1).radius! + ENEMIES.moth.radius,
    "the outer moths inside the pin's overlap distance",
  );

  await isolate(h);
  const lowest = await placeEnemy(h, "moth", PIN.x, PIN.y - ROW_GAP);
  const middle = await placeEnemy(h, "moth", PIN.x, PIN.y + ROW_GAP);
  const highest = await placeEnemy(h, "moth", PIN.x, PIN.y);
  assertTrue(
    lowest.id < middle.id && middle.id < highest.id,
    "the ids ascending in the order posed",
  );
  await placeProjectile(h, "pin", PIN.x, PIN.y, 0, 0, PIERCE);

  const hit = await h.step(1);
  await captureStill(h, "order");
  assertUndefined(
    enemyById(hit, lowest.id),
    "the lowest-id moth after the tick",
  );
  assertUndefined(
    enemyById(hit, middle.id),
    "the middle-id moth after the tick",
  );
  assertEqual(
    mustEnemy(hit, highest.id).hp,
    ENEMIES.moth.hp,
    "the highest-id moth's hp after the tick",
  );
});
