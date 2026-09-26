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
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  SPARK_LEVELS,
  SPARK_RANGE,
  cooldownFor,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armAll, holdPassives, probesAround, slotOf, timerOf } from "./night";

/** The passives held: Glass at level 5, whose areaMul is 1.5. */
const HELD: HeldPassives = { glass: 5 };

/** The Spark level fired: row 1, cooldown 2.0. */
const SPARK_LEVEL = 1;

/** max(0.2, 2.0 × 1) = 2.0, with no Oil held. */
const SPARK_COOLDOWN = cooldownFor(SPARK_LEVELS[SPARK_LEVEL - 1].cooldown, {});

/** One unit past SPARK_RANGE, where no target is eligible. */
const OUT_OF_RANGE = SPARK_RANGE + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves SPARK_RANGE as written under Glass 5", async () => {
  isolate(h);
  holdPassives(h, HELD);
  probesAround(h, "moth", [{ x: OUT_OF_RANGE, y: 0 }]);
  const sparkSlots = armAll(h, [["spark", SPARK_LEVEL]]);
  const sparked = await h.tick(1);
  captureStill(h, "fixed");

  assertLength(
    zonesOfKind(sparked, "strike"),
    0,
    `strikes with the only enemy ${OUT_OF_RANGE} units out`,
  );
  assertWithin(
    timerOf(sparked, slotOf(sparkSlots, "spark")),
    SPARK_COOLDOWN,
    FIGURE_TOLERANCE,
    "Spark's timer after a tick with no eligible target",
  );
});
