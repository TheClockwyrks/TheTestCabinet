// Wick — spark/no-target-restarts: with nothing in range, Spark's due tick
// fires nothing and restarts its cooldown.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Spark"): "Spark's
// eligible targets are the enemies within `SPARK_RANGE`: with none within it,
// whatever is alive farther away, Spark does not fire and its timer is set to
// its current cooldown"; ("Cooldown timers"): "The current cooldown is the
// table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)." Row
// 1 of `SPARK_LEVELS` gives cooldown `2.0`, and with no Oil held
// `cooldownMul` is `1` (`specs/passives.md`). So on the tick Spark's timer is
// due with one moth alive at `700`, no zone is created and the timer reads
// `2.0` after that tick.
//
// THE POSE. An isolated night with the lamplighter at the origin and one moth
// at `(700, 0)`, alive and beyond the range, then Spark held at level 1 and
// its due tick run through the shared `fireWeapon` (held, due, `weaponFire`
// on, one tick). `enemyMotion` is held so the moth stands at `700` on that
// tick. The zones created on the tick are the entries whose id is at least
// the `nextId` the tick started from.
//
// TOLERANCE. None on the count, which is exact; `TIMER_TOL` on the timer read
// straight after the tick, which a build sets from the table figure rather
// than integrating.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNear } from "../assert";
import { SPARK_RANGE, TIMER_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { SPARK, assertUntouched } from "./stage";

/** The level whose row is held: cooldown `2.0`. */
const LEVEL = 1;

/** The one moth alive, `100` beyond the range. */
const MOTH = { x: SPARK_RANGE + 100, y: 0 };

/** Spark's level-1 cooldown, `2.0` seconds. */
const COOLDOWN = weaponRow(SPARK, LEVEL).cooldown!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates no strike on Spark's due tick with the only moth at 700 and sets its timer to 2.0", async () => {
  await isolate(h);
  const moth = await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SPARK, LEVEL);
  await captureStill(h, "restart");

  assertDeepEqual(
    firing.zones.map((zone) => zone.id),
    [],
    "zones the due tick created with nothing in range",
  );
  assertUntouched(firing.after, moth, "the moth at 700");
  const slot = firing.after.run.weapons?.[firing.slot];
  assertEqual(slot?.id, SPARK, "the weapon in the slot that was due");
  assertNear(
    slot?.cooldown ?? NaN,
    COOLDOWN,
    TIMER_TOL,
    "Spark's timer after the due tick with no target",
  );
});
