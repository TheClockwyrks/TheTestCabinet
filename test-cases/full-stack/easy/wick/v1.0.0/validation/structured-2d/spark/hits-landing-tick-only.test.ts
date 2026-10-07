// spark/hits-landing-tick-only — a strike damages nothing after its tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "A strike
// deals `damage` to its target and to every other enemy within `area` of the
// target's center, on the tick it lands", and "The strike is drawn for
// `SPARK_FLASH` (`0.2`) seconds and has no hitbox after the tick it lands."
// `specs/state.md` (`ZoneState`, `ttl`): a strike is "drawn for that long
// and dealing its damage on the tick it appears alone". So the strike zone
// stays in `zones` on the tick after it landed, twelve ticks of `ttl` being
// far from due, and a moth moved onto its center on that tick takes no
// damage.
//
// WHY THE WORLD IS POSED AS IT IS. The target is chosen at random among the
// enemies within `SPARK_RANGE` (600), so the target is made certain by
// posing exactly one eligible enemy: a moth at the first post of
// `TARGET_POSTS`, 300 units out, and a second moth at `(700, 0)`, outside
// the range and 400 units from the target, so the strike neither chooses
// nor splashes it. Spark at level 1 with its timer at 0, `weaponFire` on
// and every other switch off, so no second strike arrives inside the two
// ticks (the timer reads 2.0 after the firing) and nothing but the strike
// can touch a moth. The firing tick runs: one strike lands on the target
// and the second moth is untouched. The second moth is then moved to the
// zone's center through `setEnemyPosition`, and one more tick runs with
// the zone still in the world. The moth keeps its `hp` and is still there.
//
// THE TOLERANCE. `REAL_EPS` on the moth's `hp`, read against the value it
// was posed with; the presence and count readings are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { REAL_EPS, SPARK_LEVELS, SPARK_RANGE } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  zoneById,
  type Harness,
  type Point,
} from "../harness";
import { enemyOutcome, fireSpark, hpOf, postOf, TARGET_POSTS } from "./strike";

/** Level 1 of Spark: amount 1, cooldown 2.0. */
const LEVEL = 1;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** The target within range, and the bystander 100 units past the range. */
const POSTS: readonly Point[] = [
  TARGET_POSTS[0],
  { x: SPARK_RANGE + 100, y: 0 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("leaves a moth moved onto the strike on the tick after the landing untouched", async () => {
  assertEqual(ROW.amount, 1, "the amount SPARK_LEVELS row 1 gives");
  const firing = await fireSpark(h, LEVEL, POSTS);
  const bystander = firing.targets[1];
  const hpBefore = firing.hpBefore[1];

  assertEqual(
    firing.strikes.length,
    1,
    "the strike zones the firing tick created with one moth within range",
  );
  const strike = firing.strikes[0];
  assertEqual(
    postOf(strike, POSTS, firing.before.run.player),
    0,
    `the strike centered on the moth within range, read at (${strike.x}, ${strike.y})`,
  );
  assertEqual(
    enemyOutcome(firing.after, bystander, hpBefore),
    "untouched",
    "the moth at 700 on the landing tick",
  );

  h.debug.setEnemyPosition(bystander, strike.x, strike.y);
  const after = await advanceTicks(h, 1);
  captureStill(h, "once");

  assertEqual(
    zoneById(after, strike.id) !== undefined,
    true,
    "the strike zone still in zones on the tick after the landing",
  );
  assertEqual(
    enemyOutcome(after, bystander, hpBefore),
    "untouched",
    "the moth on the strike's center on the tick after the landing",
  );
  assertNear(
    hpOf(after, bystander),
    hpBefore,
    REAL_EPS,
    "the moth's hp after the tick on the strike's center",
  );
});
