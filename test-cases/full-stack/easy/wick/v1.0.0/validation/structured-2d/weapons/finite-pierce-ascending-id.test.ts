// weapons/finite-pierce-ascending-id — a finite-pierce projectile hits
// overlapping enemies in ascending id.
//
// THE SPEC LINE. `specs/weapons.md`, "Projectiles and pierce": "When one such
// projectile overlaps several enemies on the same tick, they are hit in
// ascending enemy `id` until the projectile is removed." A pin with pierce `1`
// "hits `n + 1`" = `2` enemies, so of three it overlaps, the two with the
// lowest ids are hit and the third is untouched.
//
// THE POSE. Three moths posed in an order that puts the ids AGAINST every other
// ordering a build might use: the lowest id farthest right at `(212, 0)`, the
// middle id farthest left at `(188, 0)`, and the highest id at `(200, 0)`,
// exactly where the pin is posed and so the nearest. A build that hits
// nearest-first, or left-to-right, hits the highest id; only ascending id
// leaves it. Each center is within the `6 + 10` overlap bound, the posed pin
// "first hits ... on the next tick" (`specs/instrumentation.md`), and its
// level-1 damage `6` kills a `5` hp moth, which is how the two hits are read.
// `effectMotion` is held so the pin stays put; nothing else runs.
//
// WHAT IS READ. The moths alive after the tick, by id, which must be exactly
// the highest, and that one's hp, untouched.
//
// THE TOLERANCE. None: ids and an unchanged reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  enemyById,
  isolate,
  placeEnemyNear,
  placeProjectile,
  type Harness,
} from "../harness";

/** Where the pin is posed. */
const PIN = { x: 200, y: 0 };

/** The pin's pierce: two hits, then removed. */
const PIERCE = 1;

/** The moths in posing order, so in ascending id: right, left, then center. */
const ROW = [
  { x: 212, y: 0 },
  { x: 188, y: 0 },
  { x: 200, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("hits the two lowest ids of three overlapping moths and leaves the third", async () => {
  isolate(h);
  const moths = ROW.map((at) => placeEnemyNear(h, "moth", at.x, at.y));
  const highest = moths[moths.length - 1];
  const before = enemyById(h.snapshot(), highest);
  if (before === undefined) throw new Error("the posed moth is missing");
  placeProjectile(h, "pin", PIN.x, PIN.y, 0, 0, PIERCE);

  const struck = await advanceTicks(h, 1);
  captureStill(h, "order");

  assertDeepEqual(
    struck.run.enemies
      .filter((enemy) => moths.includes(enemy.id))
      .map((enemy) => enemy.id),
    [highest],
    "the moths alive after a pierce-1 pin's tick over three, by id (specs/weapons.md, Projectiles and pierce)",
  );
  assertEqual(
    enemyById(struck, highest)?.hp,
    before.hp,
    "the highest id's hp, untouched by the pin (specs/weapons.md, Projectiles and pierce)",
  );
});
