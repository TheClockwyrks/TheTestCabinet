// Wick — passives/spread-fixed: a spread is the named constant at every
// passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." `specs/weapons.md` has
// Pin's dart `i` "start at `x = player.x` and `y = player.y + (i - (n - 1) /
// 2) x PIN_SPREAD`" with `PIN_SPREAD` (`10`), so at amount `2` the two darts
// sit `10` apart, at `+/-5` about the lamplighter's `y`. So with Glass 5 held,
// `areaMul` `1.5`, the darts are still 10 apart. The other two lengths the
// same sentence fixes are `passives/range-fixed` and `passives/scatter-fixed`.
//
// THE POSE. An isolated night with Glass 5 held through `setPassive`, the
// largest `areaMul` the specification allows, and Pin held at level 2, the
// lowest row whose amount is `2` and so the lowest with a spread to read. One
// firing, driven the real way: the timer set to `0` and one tick. Every other
// faculty stays held, so nothing travels and the lamplighter stands at the
// origin.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each dart's offset. A scaled
// `PIN_SPREAD` puts the darts `15` apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin } from "../assert";
import {
  FIGURE_TOLERANCE,
  PIN_LEVELS,
  PIN_SPREAD,
  type HeldPassives,
} from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  projectilesOf,
  type Harness,
} from "../harness";
import { armAll, holdPassives } from "./night";

/** The passives held: Glass at level 5, whose areaMul is 1.5. */
const HELD: HeldPassives = { glass: 5 };

/** The lowest Pin row whose amount is 2, so it has a spread to read. */
const PIN_LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves PIN_SPREAD as written under Glass 5", async () => {
  isolate(h);
  holdPassives(h, HELD);
  armAll(h, [["pin", PIN_LEVEL]]);
  const pinned = await h.tick(1);
  captureStill(h, "fixed");

  const darts = projectilesOf(pinned, "pin");
  assertLength(
    darts,
    PIN_LEVELS[PIN_LEVEL - 1].amount,
    "Pin darts after the firing tick",
  );
  assertWithin(
    Math.abs(darts[0].y - darts[1].y),
    PIN_SPREAD,
    FIGURE_TOLERANCE,
    "the gap between the two darts, PIN_SPREAD",
  );
});
