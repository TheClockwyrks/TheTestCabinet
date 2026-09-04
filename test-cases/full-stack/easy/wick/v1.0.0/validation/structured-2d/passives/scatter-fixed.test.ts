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
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { MOTION_EPS, OIL_SCATTER } from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  distance,
  type Harness,
  zonesCreatedSince,
  type SnapshotZone,
  type WickSnapshot,
} from "../harness";
import { fireUnder, slotOf } from "./firing";

/** The Glass level held: `areaMul` `1.5`. */
const GLASS = 5;

/** Oil Splash firings drawn, each on a tick of its own. */
const FIRINGS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps Oil Splash's scatter within 400 under Glass 5", async () => {
  const firing = await fireUnder(h, {
    passives: [["glass", GLASS]],
    weapons: [["oil-splash", 1]],
  });

  const oilSlot = slotOf(firing, "oil-splash");
  const puddles: SnapshotZone[] = firing.zones.filter(
    (zone) => zone.kind === "puddle",
  );
  let previous: WickSnapshot = firing.after;
  for (let round = 1; round < FIRINGS; round += 1) {
    h.debug.setWeaponCooldown(oilSlot, 0);
    const next = await advanceTicks(h, 1);
    puddles.push(
      ...zonesCreatedSince(previous, next).filter(
        (zone) => zone.kind === "puddle",
      ),
    );
    previous = next;
  }
  captureStill(h, "fixed");

  assertEqual(
    puddles.length,
    FIRINGS,
    "the puddles the thirty firings landed (specs/weapons.md, Oil Splash)",
  );
  puddles.forEach((puddle, i) => {
    assertLessThanOrEqual(
      distance(puddle, { x: 0, y: 0 }),
      OIL_SCATTER + MOTION_EPS,
      `puddle ${i}: its distance from the lamplighter's center (specs/passives.md, Area)`,
    );
  });
});
