// Wick — flare/hits-all-in-radius: the burst hits every enemy within its
// radius, and nothing past it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Flare"): "On firing, every enemy within `radius` of
//     the player's center takes `damage` on that tick"; row 1 of the table has
//     damage `100` and radius `640`.
//   - `specs/weapons.md` ("Shapes and overlap"): "An enemy is within `d` of a
//     point when the distance from that point to the enemy's center is at most
//     `d`", so 640 is inside the burst and 640.5 is outside it.
//   - `specs/weapons.md` ("Derived stats"): radius is the "table value ×
//     `areaMul`"; with no passive held every multiplier is `1`
//     (`specs/passives.md`), so the radius read is 640 exactly.
//   - `specs/weapons.md` ("Hits and death"): "On any tick an enemy's `hp` is
//     at or below `0` after the hits the enemy dies on that tick: the kill
//     count rises by one"; a moth has HP `5` (`specs/enemies.md`), so the
//     row's 100 kills one.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that
//     the next tick" the weapon fires on.
//
// WHAT IS READ. After the firing tick: the five moths at distances 100, 300,
// 500, 620, and 640 are gone from `enemies` and `kills` reads 5, and the moth
// at 640.5 stands with its HP of 5 untouched.
//
// WHY THE NIGHT IS POSED AS IT IS. Flare alone at level 1, no passive held,
// every switch but `weaponFire` off: nothing spawns, nothing moves, no enemy
// touches the lamplighter, and the burst is the only thing that can remove a
// moth or raise the kill count. The six moths stand at six different bearings,
// so a build that measures along an axis rather than by distance answers
// differently from one that measures the distance the specification names.
// Each offset is a whole multiple of a 3-4-5 triple, or a point on an axis, so
// every distance is exact in binary and the boundary reading is not a rounding.
// The gems the five deaths drop land at their centers, all further than the
// lamplighter's `pickupRadius` of 48, so nothing is attracted or collected.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the surviving moth's hp, a stated
// figure read back; none on the kill count or on presence, which the
// specification decides exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  distance,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  holdWeapon,
  type Harness,
} from "../harness";
import { flareRow } from "./burst";

/** The level this point holds Flare at: radius 640, damage 100. */
const LEVEL = 1;

/** Row 1's radius, the distance the burst reaches to. */
const RADIUS = flareRow(LEVEL).radius;

/**
 * Where the moths the burst must reach stand, as offsets from the
 * lamplighter's center. Six bearings, distances 100, 300, 500, 620, and the
 * boundary itself at 640; each is a whole multiple of a 3-4-5 triple or a
 * point on an axis, so the distance is exact.
 */
const INSIDE: readonly (readonly [number, number])[] = [
  [60, 80],
  [-180, 240],
  [400, -300],
  [-620, 0],
  [640, 0],
];

/** Where the moth the burst must not reach stands: 640.5 from the center. */
const OUTSIDE: readonly [number, number] = [0, -640.5];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("kills the five moths out to 640 and leaves the moth at 640.5 untouched", async () => {
  isolate(h);
  const inside = INSIDE.map(([dx, dy]) => spawnEnemyNear(h, "moth", dx, dy));
  const outside = spawnEnemyNear(h, "moth", OUTSIDE[0], OUTSIDE[1]);
  const slot = holdWeapon(h, "flare", LEVEL);
  const posed = h.snapshot();
  for (const [index, [dx, dy]] of INSIDE.entries()) {
    assertWithin(
      distance({ x: 0, y: 0 }, { x: dx, y: dy }),
      [100, 300, 500, 620, RADIUS][index],
      FIGURE_TOLERANCE,
      `the distance moth ${index + 1} stands at`,
    );
  }
  assertEqual(posed.run.kills, 0, "kills before the firing tick");
  armWeapon(h, slot);

  const after = await h.tick(1);
  captureStill(h, "burst");

  for (const [index, id] of inside.entries()) {
    assertUndefined(
      enemyById(after, id),
      `the moth at ${[100, 300, 500, 620, RADIUS][index]} after the burst`,
    );
  }
  assertEqual(after.run.kills, INSIDE.length, "kills after the burst");
  const survivor = present(
    enemyById(after, outside),
    "the moth at 640.5 after the burst",
  );
  assertWithin(
    survivor.hp,
    ENEMIES.moth.hp,
    FIGURE_TOLERANCE,
    "the hp of the moth at 640.5",
  );
});
