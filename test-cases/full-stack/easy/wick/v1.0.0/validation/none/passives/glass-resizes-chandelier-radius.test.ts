// Wick — passives/glass-resizes-chandelier-radius: a Chandelier lantern's
// radius is recomputed from `areaMul` on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and
// Corona aura's radius and a Chandelier lantern's orbit and radius are
// recomputed on every tick from the level and `areaMul` in force on that
// tick." `specs/evolutions.md` ("Chandelier") says the same, over the fixed
// row `CHANDELIER_STATS`, orbit `120`, radius `20`, amount `4`. `areaMul` is
// `1` with no Glass held and `1.2` at Glass 2 (`GLASS_AREA_PER_LEVEL` `0.1`),
// so the lanterns read radius 20 and then 24. The other length recomputed with
// it is `passives/glass-resizes-chandelier-orbit`.
//
// THE POSE. An isolated night with Chandelier held through `setWeapon` and one
// tick, which creates the set; the four lanterns are read. Glass 2 is then
// placed through `setPassive` and one more tick runs. Every faculty stays
// held: Chandelier "has no cooldown", and with `effectMotion` off the lanterns
// hold their angles, so the distance read is the circle the placement put them
// on. The lamplighter stands at the origin throughout, so that distance is the
// orbit itself.
//
// TOLERANCE. `FLOAT_TOL` on the radius and `POSITION_TOL` (`1e-6`) on the
// orbit, a distance a build computed from a cosine and a sine. A build that
// fixed the length at creation is units away on the second reading.

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
  type WickSnapshot,
  zonesOf,
} from "../harness";

/** The Glass level gained while the set lives: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The fixed row every reading scales: orbit `120`, radius `20`, amount `4`. */
const ROW = weaponRow("chandelier");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Read every lantern's radius against the fixed row times `scale`. */
function assertSet(snapshot: WickSnapshot, scale: number, when: string): void {
  const lanterns = zonesOf(snapshot, "chandelier");
  assertEqual(lanterns.length, ROW.amount, `Chandelier lanterns ${when}`);
  for (const lantern of lanterns) {
    assertNear(
      lantern.radius,
      (ROW.radius ?? NaN) * scale,
      FLOAT_TOL,
      `lantern ${lantern.id}'s radius ${when}`,
    );
  }
}

it("reads the lanterns at radius 20 and then 24 after Glass rises to 2", async () => {
  await isolate(h);
  await holdWeapon(h, "chandelier");

  const placed = await h.step(1);
  assertSet(placed, 1, "with no Glass held");

  await holdPassive(h, "glass", GLASS_LEVEL);
  const resized = await h.step(1);
  await captureStill(h, "resized");

  assertSet(
    resized,
    areaMul({ glass: GLASS_LEVEL }),
    "on the tick after Glass rose to 2",
  );
});
