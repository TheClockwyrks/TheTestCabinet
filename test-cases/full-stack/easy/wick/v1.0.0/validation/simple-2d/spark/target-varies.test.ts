// Wick — spark/target-varies: the enemy a strike lands on is chosen at random
// among those within range.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "On firing, `amount` strikes land, each on
//     a distinct enemy chosen uniformly at random among the live enemies
//     within `SPARK_RANGE` (`600`) of the player's center"; the level-1 row
//     has amount `1` and damage `15`.
//   - `specs/instrumentation.md` ("Seeded randomness"): "every random draw
//     comes from" the one seeded generator, "a strike's target" among them,
//     and `reset` seeds it, so the forty firings below are one deterministic
//     sequence from `DEFAULT_SEED`.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick" the weapon fires on, so each of the forty firings is posed
//     due and run on its own tick.
//   - `specs/state.md` (`ZoneState`): a strike's "`x`, `y`" is "the center of
//     the circle", which a strike lands about its target's center, and its
//     `id` is "unique for the run, assigned from `nextId`", which is what tells
//     this firing's strike from the flashes of the firings before it.
//   - `specs/enemies.md`: an owl has HP `2000`, so forty strikes of `15` on
//     one owl leave it alive, and the four owls stand with their ids unchanged
//     through every firing.
//
// WHAT IS READ. Four owls within range; Spark fires forty times at level 1,
// each firing's one new strike matched to the owl it is centered on; every
// one of the four owls is struck at least once. A build that always strikes
// the nearest, the lowest id, or the first in its list strikes the same owl
// forty times and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Four owls and Spark alone at level 1,
// every switch off but `weaponFire`, so nothing moves and each owl's posed
// center is what a strike is matched against; the owls stand at least `250`
// apart, beyond any area, so each firing's strike is centered on one owl
// alone. Owls rather than moths because a target that dies would be replaced
// under a fresh id, and a picker that takes the first or the newest enemy
// would then wander across the posts without choosing anything at random;
// four enemies whose ids never change are what tell a choice from a rule.
//
// TOLERANCE. `FIGURE_TOLERANCE` on a strike's center against an owl's posed
// center. The bound itself is the description's: under a uniform choice among
// four, a given owl goes unstruck in forty firings with probability `(3/4)^40`,
// about one in a hundred thousand, and any of the four about four in a hundred
// thousand, so a conformant build fails on that few seeds and a build that
// never varies its choice fails on every seed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ENEMIES } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { armSpark, sparkRow, strikesIn, targetOf, targetsFor } from "./strike";

/** The level held: amount 1, one strike a firing. */
const LEVEL = 1;

/** The enemy at every post: HP 2000, alive through forty strikes of 15. */
const TYPE = "owl";

/** How many owls stand within range. */
const POSTS = 4;

/** How many times Spark fires. */
const FIRINGS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("strikes each of four owls at least once over forty firings from one seed", async () => {
  const row = sparkRow(LEVEL);
  assertEqual(row.amount, 1, "the level-1 row's amount");
  assertGreaterThanOrEqual(
    ENEMIES[TYPE].hp,
    FIRINGS * row.damage + 1,
    "an owl's HP against forty strikes",
  );
  const volley = armSpark(h, LEVEL, targetsFor(POSTS), TYPE);
  const owls = volley.targets;
  const struck = owls.map(() => 0);
  const seen = new Set<number>();

  for (let firing = 1; firing <= FIRINGS; firing += 1) {
    armWeapon(h, volley.slot);
    const after = await h.tick(1);
    assertEqual(
      after.run.enemies.length,
      POSTS,
      `owls alive after firing ${firing}`,
    );
    const fresh = strikesIn(after).filter((strike) => !seen.has(strike.id));
    for (const strike of fresh) seen.add(strike.id);
    assertEqual(fresh.length, 1, `new Spark strikes on firing ${firing}`);
    struck[targetOf(fresh[0], owls, `the strike of firing ${firing}`)] += 1;
  }
  captureStill(h, "random");

  struck.forEach((count, index) => {
    assertGreaterThanOrEqual(
      count,
      1,
      `strikes on the owl ${index + 1} of ${POSTS} over ${FIRINGS} firings`,
    );
  });
});
