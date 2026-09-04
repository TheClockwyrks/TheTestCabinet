// Wick — passives/scatter-fixed: a scatter is the named constant at every
// passive level.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "Every other
// length a weapon uses is used as written: `SPARK_RANGE`, `OIL_SCATTER`,
// `PIN_SPREAD`, `SHARD_SPREAD`, and `SCONCE_SPREAD`." `specs/weapons.md` has
// each Oil Splash puddle "centered at an independent uniformly random point of
// the disk of radius `OIL_SCATTER` (`400`) about the player's center". So with
// Glass 5 held, `areaMul` `1.5`, every puddle still lands within `400`. The
// other two lengths the same sentence fixes are `passives/spread-fixed` and
// `passives/range-fixed`.
//
// THE POSE. An isolated night with Glass 5 held through `setPassive`, the
// largest `areaMul` the specification allows, and Oil Splash held at level 1.
// `FIRINGS` (`20`) firings are driven, each the real way: the timer set to `0`
// and one tick. The landing points are read over all twenty, because a single
// random draw of a scatter scaled to `600` lands inside `400` four times in
// nine, and twenty independent draws do not.
//
// TOLERANCE. `POSITION_TOL` (`1e-6`) on each puddle's distance from the
// center. A scaled `OIL_SCATTER` reaches `600`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { OIL_SCATTER, type HeldPassives } from "../constants";
import {
  captureStill,
  createHarness,
  enable,
  holdWeapon,
  isolate,
  zonesOf,
  type Harness,
} from "../harness";
import { holdPassives } from "./night";

/** The passives held: Glass at level 5, whose areaMul is 1.5. */
const HELD: HeldPassives = { glass: 5 };

/** How many independent Oil Splash landing points are sampled. */
const SAMPLES = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves OIL_SCATTER as written under Glass 5", async () => {
  isolate(h);
  holdPassives(h, HELD);
  const oilSlot = holdWeapon(h, "oil-splash", 1);
  enable(h, "weaponFire");
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    h.debug.setWeaponCooldown(oilSlot, 0);
    const splashed = await h.tick(1);
    const { player } = splashed.run;
    const puddles = zonesOf(splashed, "oil-splash");
    assertLength(puddles, 1, `puddles laid by firing ${sample + 1}`);
    assertLessThanOrEqual(
      Math.hypot(puddles[0].x - player.x, puddles[0].y - player.y),
      OIL_SCATTER,
      `puddle ${sample + 1}: its distance from the lamplighter's center`,
    );
    h.debug.clearZones();
  }
  captureStill(h, "fixed");
});
