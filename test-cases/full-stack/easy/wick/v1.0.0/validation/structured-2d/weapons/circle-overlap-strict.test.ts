// weapons/circle-overlap-strict — two circles overlap only when closer than
// their radii's sum.
//
// THE SPEC LINE. `specs/weapons.md`, "Shapes and overlap": "Two circles
// overlap when the distance between their centers is less than the sum of
// their radii." and "An effect hits an enemy when the effect's shape overlaps
// the enemy's circle". An Ember bolt's level-1 radius is `8` and a moth's is
// `10` (`specs/enemies.md`), so the bound is `18`: a bolt whose center is
// exactly `18` from the moth's never hits, and one at `17.9` hits on its first
// tick.
//
// WHY BOTH SIDES OF THE BOUND, IN ONE POINT. `hit-removes-damage` already
// grades that a bolt on an enemy's center hits. What this point decides is
// WHERE the bound falls and that it is strict, which is one fact with two
// faces: a build that tests `<=` hits at `18`, and a build whose bound is the
// bolt's radius alone, or the moth's, misses at `17.9`. So a bolt is posed at
// exactly `18` for `60` ticks and the moth's hp must not move, then a bolt at
// `17.9` for one tick and the moth must be hit. Sixty ticks is half the bolt's
// `2.0` second `ttl`, and a posed projectile "first hits ... on the next tick"
// (`specs/instrumentation.md`), so had `18` counted as overlap the hit would
// have landed on the first of them.
//
// WHY THE POSES ARE EXACT. The moth at `(200, 0)` and the bolts at `(218, 0)`
// and `(217.9, 0)`: `218 − 200` is exactly `18` in floating point, and
// `217.9 − 200` rounds to a hair over `17.9`, well inside `18`. `effectMotion`
// and `enemyMotion` are held, so both hold their posed centers across the
// whole span and the bound is tested at exactly `18`, not at `18` plus a step
// of drift; `enemyContact` is held so no other damage enters.
//
// THE TOLERANCE. Whether hp moved at all is read exactly; the hit at `17.9` is
// read as the moth gone or its hp lowered, since a level-1 bolt's `10` kills
// a `5` hp moth.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { EMBER_LEVELS, ENEMIES } from "../constants";
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

/** Where the moth stands. */
const MOTH = { x: 200, y: 0 };

/** The overlap bound for a level-1 bolt and a moth: `8 + 10`. */
const BOUND = EMBER_LEVELS[0].radius + ENEMIES.moth.radius;

/** A tenth of a unit inside the bound: the nearest figure the tables distinguish. */
const INSIDE = BOUND - 0.1;

/** Ticks the bolt at the bound is watched for: half its `ttl`. */
const WATCH = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands no hit at exactly the radii's sum and a hit a tenth inside it", async () => {
  isolate(h);

  const atBound = placeEnemyNear(h, "moth", MOTH.x, MOTH.y);
  const before = enemyById(h.snapshot(), atBound);
  if (before === undefined) throw new Error("the posed moth is missing");
  placeProjectile(h, "ember", before.x + BOUND, before.y, 0, 0, 0);
  const held = await advanceTicks(h, WATCH);
  assertEqual(
    enemyById(held, atBound)?.hp,
    before.hp,
    `the moth's hp after ${WATCH} ticks with a bolt centered exactly ${BOUND} units away (specs/weapons.md, Shapes and overlap)`,
  );

  h.debug.removeEnemy(atBound);
  h.debug.clearProjectiles();
  const inside = placeEnemyNear(h, "moth", MOTH.x, MOTH.y);
  const insideBefore = enemyById(h.snapshot(), inside);
  if (insideBefore === undefined) throw new Error("the posed moth is missing");
  placeProjectile(h, "ember", insideBefore.x + INSIDE, insideBefore.y, 0, 0, 0);
  const struck = await advanceTicks(h, 1);
  captureStill(h, "boundary");

  const after = enemyById(struck, inside);
  assertTrue(
    after === undefined || after.hp < insideBefore.hp,
    `the moth hit on the first tick with a bolt centered ${INSIDE} units away, gone or with its hp lowered (specs/weapons.md, Shapes and overlap)`,
  );
});
