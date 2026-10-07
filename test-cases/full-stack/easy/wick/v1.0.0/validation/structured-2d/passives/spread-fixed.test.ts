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
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS, PIN_LEVELS, PIN_SPREAD } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { fireUnder } from "./firing";

/** The Glass level held: `areaMul` `1.5`. */
const GLASS = 5;

/** Pin's level-2 row, whose `amount` is `2`. */
const PIN_ROW = PIN_LEVELS[1];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Pin's spread at 10 under Glass 5", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["pin", 2]],
  });
  captureStill(h, "fixed");

  const darts = firing.projectiles.filter((p) => p.weapon === "pin");
  assertEqual(
    darts.length,
    PIN_ROW.amount,
    "the darts the firing tick created (specs/weapons.md, Pin)",
  );
  const { player } = firing.after.run;
  darts
    .slice()
    .sort((a, b) => a.y - b.y)
    .forEach((dart, i) => {
      assertNear(
        dart.y - player.y,
        (i - (PIN_ROW.amount - 1) / 2) * PIN_SPREAD,
        MOTION_EPS,
        `dart ${i}: its offset from the lamplighter's y (specs/passives.md, Area)`,
      );
    });
});
