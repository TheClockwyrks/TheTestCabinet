// Wick — weapons/circle-overlap-strict: two circles overlap only when their
// centers are strictly closer than the sum of their radii.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shapes and overlap"): "Two circles overlap when the
//     distance between their centers is less than the sum of their radii", and
//     "An effect hits an enemy when the effect's shape overlaps the enemy's
//     circle".
//   - `specs/weapons.md` ("Ember"): level-1 radius `8`; `specs/enemies.md`: a
//     moth has HP `5`, radius `10`, so the radii sum to 18 and the bolt's 10
//     damage kills on a hit.
//   - `specs/instrumentation.md` (`spawnProjectile`): a posed bolt's "`radius`
//     is the weapon's table radius ... times the `areaMul` in force", `1` with
//     no Glass held, and it "first hits ... on the next tick".
//
// WHAT IS READ. Two scenes. A bolt posed with its center exactly 18 units from
// a moth's, at rest, never hits it: after 30 ticks the moth stands with its hp
// untouched and the bolt is still there. A bolt posed at 17.9 units hits on
// the next tick: the moth is gone. A build testing `<=` fails the first scene;
// one whose overlap is short of the radii's sum fails the second.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and one bolt per scene, 150 units
// from the lamplighter along +x, every switch off: nothing moves, so the
// distance the tick reads is the posed one. The moth stands at an integer
// position and the boundary bolt 18 units along +x of it, so the 18 is an
// exact double and no rounding of the build's own can carry it inside.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the untouched moth's hp; none on presence.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertWithin } from "../assert";
import { EMBER_LEVELS, ENEMIES, FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  projectileById,
  spawnEnemyNear,
  spawnProjectileAt,
  type Harness,
} from "../harness";

/** Where the moth stands: along +x, clear of the lamplighter. */
const MOTH_DX = 150;

/** The radii's sum: the boundary the rule is strict at. */
const BOUNDARY = EMBER_LEVELS[0].radius + ENEMIES.moth.radius;

/** Just inside the boundary. */
const INSIDE = BOUNDARY - 0.1;

/** How long the boundary bolt is left to not hit, in ticks. */
const QUIET_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("never hits at exactly 18 units of center distance, and hits at 17.9", async () => {
  // At the boundary: no overlap, ever.
  isolate(h);
  const spared = spawnEnemyNear(h, "moth", MOTH_DX, 0);
  const sparedPlaced = present(
    enemyById(h.snapshot(), spared),
    "the boundary scene's moth",
  );
  const boundaryBolt = spawnProjectileAt(
    h,
    "ember",
    sparedPlaced.x + BOUNDARY,
    sparedPlaced.y,
    0,
    0,
    0,
  );
  assertEqual(
    projectileById(h.snapshot(), boundaryBolt)?.radius,
    EMBER_LEVELS[0].radius,
    "the boundary bolt's radius",
  );
  const quiet = await h.tick(QUIET_TICKS);
  captureStill(h, "boundary");
  const untouched = present(
    enemyById(quiet, spared),
    `the moth after ${QUIET_TICKS} ticks at the boundary`,
  );
  assertWithin(
    untouched.hp,
    sparedPlaced.hp,
    FIGURE_TOLERANCE,
    "the moth's hp at the boundary",
  );
  assertDefined(
    projectileById(quiet, boundaryBolt),
    `the bolt after ${QUIET_TICKS} ticks at the boundary`,
  );

  // Inside the boundary: the hit lands on the next tick.
  isolate(h);
  const struck = spawnEnemyNear(h, "moth", MOTH_DX, 0);
  const struckPlaced = present(
    enemyById(h.snapshot(), struck),
    "the inside scene's moth",
  );
  spawnProjectileAt(
    h,
    "ember",
    struckPlaced.x + INSIDE,
    struckPlaced.y,
    0,
    0,
    0,
  );
  const hit = await h.tick(1);
  assertEqual(
    enemyById(hit, struck),
    undefined,
    "the moth after a tick at 17.9",
  );
});
