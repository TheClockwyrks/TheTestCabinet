// spark/no-target-restarts — Spark restarts its cooldown with nothing in
// range.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "Spark's
// eligible targets are the enemies within `SPARK_RANGE`: with none within
// it, whatever is alive farther away, Spark does not fire and its timer is
// set to its current cooldown." And ("Cooldown timers"): "The current
// cooldown is the table cooldown times `cooldownMul`, floored at
// `MIN_COOLDOWN` (`0.2`)", which with no Oil held is level 1's table
// cooldown of `2.0` (`specs/passives.md` gives `cooldownMul` as `1` at Oil
// level 0). So on the due tick with a moth alive at 700 and none within
// 600, no strike zone is created, the moth is untouched, and the timer reads
// `2` after that tick.
//
// WHY THE TIMER READS THE COOLDOWN AND NOT A COUNTED-DOWN VALUE. The timer
// is set on the due tick itself, after the count-down that made it due
// (`specs/world.md`, "One tick", phase 5: "each held weapon's timer counts
// down, and each weapon whose timer is due fires"); the count-down of the
// next tick has not happened yet when the snapshot is read.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth at
// `(700, 0)`, alive and 100 units past the range, Spark at level 1 with its
// timer at 0, `weaponFire` on and every other switch off, so nothing moves
// the moth into range before the due tick and nothing but Spark's own rule
// sets its timer. A build that strikes the nearest enemy whatever its
// distance shows a zone and a struck moth here.
//
// THE TOLERANCE. `REAL_EPS` on the timer, a table value times a multiplier
// of `1`, and on the moth's hp against the value it was posed with; a build
// that left the timer at `0` is off by the whole cooldown, and one that
// fired anyway shows a zone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { cooldownOf, REAL_EPS, SPARK_LEVELS, SPARK_RANGE } from "../constants";
import {
  captureStill,
  createHarness,
  type Harness,
  type Point,
} from "../harness";
import { enemyOutcome, fireSpark, hpOf } from "./strike";

/** Level 1 of Spark: table cooldown 2.0. */
const LEVEL = 1;
const ROW = SPARK_LEVELS[LEVEL - 1];

/** The current cooldown with no Oil held: `max(0.2, 2.0 × 1)`. */
const CURRENT_COOLDOWN = cooldownOf(ROW.cooldown, 0);

/** The one moth, 100 units past the range. */
const POSTS: readonly Point[] = [{ x: SPARK_RANGE + 100, y: 0 }];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates no strike on the due tick with the only moth at 700 and sets the timer to 2", async () => {
  const firing = await fireSpark(h, LEVEL, POSTS);
  captureStill(h, "restart");

  assertEqual(
    firing.after.run.enemies.length,
    1,
    "the enemies alive on the due tick",
  );
  assertEqual(
    firing.after.run.zones.length,
    0,
    "the zones after Spark's due tick with nothing within SPARK_RANGE",
  );
  assertEqual(
    enemyOutcome(firing.after, firing.targets[0], firing.hpBefore[0]),
    "untouched",
    "the moth at 700 on the due tick",
  );
  assertNear(
    hpOf(firing.after, firing.targets[0]),
    firing.hpBefore[0],
    REAL_EPS,
    "the moth's hp after the due tick",
  );
  assertNear(
    firing.after.run.weapons[firing.slot].cooldown,
    CURRENT_COOLDOWN,
    REAL_EPS,
    "Spark's timer after the due tick, against its current cooldown",
  );
});
