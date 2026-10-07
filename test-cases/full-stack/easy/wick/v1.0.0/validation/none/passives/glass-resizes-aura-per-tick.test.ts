// Wick — passives/glass-resizes-aura-per-tick: the aura's radius is recomputed
// from `areaMul` on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and Corona
// aura's radius and a Chandelier lantern's orbit and radius are recomputed on
// every tick from the level and `areaMul` in force on that tick."
// `specs/world.md` (phase 5) runs that recomputation "on every `playing` tick".
// Row 1 of `HALO_LEVELS` (`specs/weapons.md`) carries radius `80`, and
// `areaMul` is `1` with no Glass held and `1.2` at Glass 2
// (`GLASS_AREA_PER_LEVEL` `0.1`), so the aura reads `80` and then `96`.
//
// THE POSE. An isolated night with Halo held at level 1 through `setWeapon` and
// one tick, which creates the aura; its radius is read. Glass 2 is then placed
// through `setPassive` and one more tick runs, and the SAME zone id is read
// again, so a build that removed and rebuilt the aura is not silently passed.
// Every faculty stays held, `weaponFire` included: the requirement is the
// length the zone carries rather than a pulse, and no enemy is posed for one.
//
// TOLERANCE. `FLOAT_TOL` on each radius, a table figure times exactly `1` and
// `1.2`. A build that fixed the radius at creation reads `80` on both ticks,
// sixteen units from the second reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, areaMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  holdWeapon,
  isolate,
  mustZone,
  type Harness,
  zonesOfKind,
} from "../harness";

/** The Glass level gained while the aura lives: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The Halo level held: table radius `80`. */
const LEVEL = 1;

/** The table radius both readings scale. */
const RADIUS = weaponRow("halo", LEVEL).radius ?? NaN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the aura at radius 80 and then at 96 on the tick after Glass rises to 2", async () => {
  await isolate(h);
  await holdWeapon(h, "halo", LEVEL);

  const placed = await h.step(1);
  const auras = zonesOfKind(placed, "aura");
  assertEqual(auras.length, 1, "zones of kind aura on the tick Halo is held");
  assertNear(
    auras[0]!.radius,
    RADIUS,
    FLOAT_TOL,
    "the aura's radius with no Glass held",
  );

  await holdPassive(h, "glass", GLASS_LEVEL);
  const resized = await h.step(1);
  await captureStill(h, "resized");

  assertNear(
    mustZone(resized, auras[0]!.id).radius,
    RADIUS * areaMul({ glass: GLASS_LEVEL }),
    FLOAT_TOL,
    "the aura's radius on the tick after Glass rose to 2",
  );
});
