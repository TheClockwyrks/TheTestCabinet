// Wick — passives/range-fixed: a range is the named constant at every passive
// level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." `specs/weapons.md` has
// Spark's "eligible targets are the enemies within `SPARK_RANGE` (`600`)" and
// "with none within it ... Spark does not fire". So with Glass 5 held,
// `areaMul` `1.5`, a lone enemy at `601` still draws no strike. The other two
// lengths the same sentence fixes are `passives/spread-fixed` and
// `passives/scatter-fixed`.
//
// THE POSE. An isolated night with Glass 5 held through `setPassive`, the
// largest `areaMul` the specification allows, one hound one unit past
// `SPARK_RANGE`, and Spark held at level 1. `FIRINGS` (`20`) firings are
// driven, each the real way: the timer set to `0` and one tick. Every other
// faculty stays held, so the hound never moves closer.
//
// TOLERANCE. None: the count of strikes is exact. A scaled `SPARK_RANGE`
// reaches `900` and would strike on every firing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, SPARK_RANGE } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  enemyById,
  type Harness,
  zonesCreatedSince,
  type WickSnapshot,
} from "../harness";
import { fireUnder, slotOf } from "./firing";

/** The Glass level held: `areaMul` `1.5`. */
const GLASS = 5;

/** Where the hound stands: one unit outside `SPARK_RANGE`. */
const OUT_OF_RANGE = { x: SPARK_RANGE + 1, y: 0 };

/** Spark firings driven, each on a tick of its own. */
const FIRINGS = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Spark's range at 600 under Glass 5", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["spark", 1]],
    enemies: [["hound", OUT_OF_RANGE]],
  });

  const sparkSlot = slotOf(firing, "spark");
  let strikes = firing.zones.filter((zone) => zone.kind === "strike").length;
  let previous: WickSnapshot = firing.after;
  for (let round = 1; round < FIRINGS; round += 1) {
    h.debug.setWeaponCooldown(sparkSlot, 0);
    const next = await advanceTicks(h, 1);
    strikes += zonesCreatedSince(previous, next).filter(
      (zone) => zone.kind === "strike",
    ).length;
    previous = next;
  }
  captureStill(h, "fixed");

  assertEqual(
    strikes,
    0,
    "the strikes Spark landed with its only enemy 601 units out (specs/passives.md, Area)",
  );
  assertNear(
    distance(enemyById(previous, firing.targets[0]) ?? { x: NaN, y: NaN }, {
      x: 0,
      y: 0,
    }),
    SPARK_RANGE + 1,
    MOTION_EPS,
    "the hound's distance from the lamplighter across the watch (specs/world.md)",
  );
});
