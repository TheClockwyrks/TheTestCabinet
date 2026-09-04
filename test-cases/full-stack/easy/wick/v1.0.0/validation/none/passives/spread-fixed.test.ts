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
import { PIN_SPREAD, POSITION_TOL, weaponRow } from "../constants";
import {
  armWeapon,
  captureStill,
  createHarness,
  enable,
  holdPassive,
  holdWeapon,
  isolate,
  newProjectiles,
  type Harness,
} from "../harness";

/** The Glass level held: `areaMul` `1.5`, the largest the passive allows. */
const GLASS_LEVEL = 5;

/** The Pin level held: table amount `2`. */
const PIN_LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps Pin's spread at 10 with Glass 5 held", async () => {
  const opened = await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  const slot = await holdWeapon(h, "pin", PIN_LEVEL);
  await enable(h, "weaponFire");
  await armWeapon(h, slot);

  const before = await h.snapshot();
  const after = await h.step(1);
  await captureStill(h, "fixed");

  const darts = newProjectiles(before, after).filter(
    (shot) => shot.weapon === "pin",
  );
  assertEqual(
    darts.length,
    weaponRow("pin", PIN_LEVEL).amount,
    "Pin darts the firing created",
  );
  const at = opened.run.player;
  darts
    .slice()
    .sort((a, b) => a.y - b.y)
    .forEach((dart, i) => {
      assertNear(
        dart.y - at.y,
        (i - (darts.length - 1) / 2) * PIN_SPREAD,
        POSITION_TOL,
        `dart ${i}'s offset from the lamplighter's y with Glass 5 held`,
      );
    });
});
