// Wick — passives/glass-scales-aura-radius: `areaMul` scales the aura's radius.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): the table names
// "Halo, Corona | aura `radius`" among the lengths `areaMul` scales, over
// "`areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`" with `GLASS_AREA_PER_LEVEL`
// (`0.1`). Row 1 of `HALO_LEVELS` (`specs/weapons.md`) carries radius `80`, so
// with Glass at level 2 the aura reads `96`.
//
// THE POSE. An isolated night with Glass 2 held through `setPassive` and Halo
// held at level 1 through `setWeapon`, then one tick. `specs/world.md`
// (phase 5) creates the aura on "a tick its weapon is held and none exists" and
// recomputes its radius "on every `playing` tick" whatever the driver switches
// hold, so every faculty stays held, `weaponFire` included: the requirement is
// the length the zone carries, not a pulse, and no enemy is posed for one.
//
// TOLERANCE. `FLOAT_TOL` on the radius, a table figure times exactly `1.2`. The
// unscaled `80` is sixteen units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  type Harness,
  zonesOfKind,
} from "../harness";

/** The Glass level held: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The Halo level held: table radius `80`. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads radius 96 on the level-1 Halo aura with Glass 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "glass", GLASS_LEVEL);
  await holdWeapon(h, "halo", LEVEL);

  const placed = await h.step(1);
  await captureStill(h, "aura");

  const auras = zonesOfKind(placed, "aura");
  assertEqual(auras.length, 1, "zones of kind aura on the tick Halo is held");
  assertNear(
    auras[0]!.radius,
    (weaponRow("halo", LEVEL).radius ?? NaN) * areaMul({ glass: GLASS_LEVEL }),
    FLOAT_TOL,
    "the aura's radius with Glass 2 held",
  );
});
