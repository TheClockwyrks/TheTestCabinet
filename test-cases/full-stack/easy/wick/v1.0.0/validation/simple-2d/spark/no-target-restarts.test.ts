// Wick — spark/no-target-restarts: with no enemy within SPARK_RANGE, Spark's
// due tick lands nothing and sets its timer to its current cooldown.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Spark"): "Spark's eligible targets are the enemies
//     within `SPARK_RANGE`: with none within it, whatever is alive farther
//     away, Spark does not fire and its timer is set to its current cooldown";
//     the level-1 row has cooldown `2.0`.
//   - `specs/weapons.md` ("Cooldown timers"): "A weapon that needs a target
//     and finds no eligible target does not fire on that tick, and its timer
//     is set to its current cooldown as though it had", where "The current
//     cooldown is the table cooldown times `cooldownMul`, floored at
//     `MIN_COOLDOWN`", `1` times the table figure with no Oil held
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Shapes and overlap"): an enemy is within `d` of a
//     point "when the distance from that point to the enemy's center is at
//     most `d`", so a moth at `700` is not within `600`.
//   - `specs/instrumentation.md`: "`setWeaponCooldown(slot, 0)` makes that the
//     next tick", so the one tick run is the due tick.
//
// WHAT IS READ. After the due tick with one moth alive at `700`: the count of
// Spark strikes, `0`, and Spark's timer, `2.0`. A build that strikes the moth
// beyond the range, leaves the timer at `0` to try again next tick, or sets it
// to anything but the current cooldown fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth at `700` and Spark alone at
// level 1, every switch off but `weaponFire`, which is the faculty this item
// is about. The moth is alive so a build that falls back to whatever is alive
// farther away is told from one that does not; `enemyMotion` off holds it
// beyond the range for the due tick.
//
// TOLERANCE. `FIGURE_TOLERANCE` on the timer, a stated figure read back as a
// double. None on the count, a whole number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { SPARK_RANGE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { armSpark, assertTimerOfRow, sparkRow, strikesIn } from "./strike";

/** The level held; any row would do, and its cooldown is the figure read. */
const LEVEL = 1;

/** Where the one moth stands: beyond the range, along +x. */
const FAR_DX = 700;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("lands no strike on the due tick with the only moth at 700 and restarts the timer", async () => {
  assertGreaterThan(FAR_DX, SPARK_RANGE, "the moth against the range");
  const volley = armSpark(h, LEVEL, [{ x: FAR_DX, y: 0 }]);
  assertEqual(volley.posed.run.enemies.length, 1, "enemies alive");

  const after = await h.tick(1);
  captureStill(h, "restart");

  assertEqual(strikesIn(after).length, 0, "Spark strikes after the due tick");
  assertTimerOfRow(after, volley.slot, sparkRow(LEVEL));
});
