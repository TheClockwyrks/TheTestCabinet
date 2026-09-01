// Wick — passives/glass-resizes-chandelier-per-tick: a Chandelier lantern's
// orbit and radius are recomputed from `areaMul` on every tick.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and Corona
// aura's radius and a Chandelier lantern's orbit and radius are recomputed on
// every tick from the level and `areaMul` in force on that tick."
// `specs/evolutions.md` ("Chandelier") says the same: "`orbit`, each lantern's
// `radius`, and each lantern's `damage` are recomputed on every tick from the
// `areaMul` and `damageMul` in force on that tick", over the fixed row
// `CHANDELIER_STATS`, orbit `120`, radius `20`, amount `4`. `areaMul` is `1`
// with no Glass held and `1.2` at Glass 2 (`GLASS_AREA_PER_LEVEL` `0.1`), so
// the lanterns read radius `20` on a circle of `120`, and radius `24` on a
// circle of `144`.
//
// THE POSE. An isolated night with Chandelier held through `setWeapon` and one
// tick, which creates the set under `specs/world.md`'s placement; the four
// lanterns are read. Glass 2 is then placed through `setPassive` and one more
// tick runs. Every faculty stays held: Chandelier "has no cooldown", and with
// `effectMotion` off the lanterns hold their angles, so the distance read is
// the circle the placement put them on. The lamplighter stands at the origin
// throughout, so that distance is the orbit itself.
//
// TOLERANCE. `FLOAT_TOL` on each radius and `POSITION_TOL` (`1e-6`) on each
// orbit, a distance a build computed from a cosine and a sine. A build that
// fixed the lengths at creation is `4` and `24` units away on the second
// reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, areaMul, weaponRow } from "../constants";
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
import { orbitOf } from "./stage";

/** The Glass level gained while the set lives: `areaMul` `1.2`. */
const GLASS_LEVEL = 2;

/** The fixed row every reading scales: orbit `120`, radius `20`, amount `4`. */
const ROW = weaponRow("chandelier");

/** Every Chandelier lantern `snapshot` holds, in id order. */
const lanternsOf = (snapshot: WickSnapshot) => zonesOf(snapshot, "chandelier");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the lanterns at radius 20 on an orbit of 120 and then 24 on 144 after Glass rises to 2", async () => {
  await isolate(h);
  await holdWeapon(h, "chandelier");

  const placed = await h.step(1);
  const before = lanternsOf(placed);
  assertEqual(
    before.length,
    ROW.amount,
    "Chandelier lanterns on the tick it is held",
  );
  for (const lantern of before) {
    assertNear(
      lantern.radius,
      ROW.radius ?? NaN,
      FLOAT_TOL,
      `lantern ${lantern.id}'s radius with no Glass held`,
    );
    assertNear(
      orbitOf(placed, lantern),
      ROW.orbit ?? NaN,
      POSITION_TOL,
      `lantern ${lantern.id}'s orbit with no Glass held`,
    );
  }

  await holdPassive(h, "glass", GLASS_LEVEL);
  const resized = await h.step(1);
  await captureStill(h, "resized");

  const after = lanternsOf(resized);
  const scale = areaMul({ glass: GLASS_LEVEL });
  assertEqual(
    after.length,
    ROW.amount,
    "Chandelier lanterns on the tick after Glass rose to 2",
  );
  for (const lantern of after) {
    assertNear(
      lantern.radius,
      (ROW.radius ?? NaN) * scale,
      FLOAT_TOL,
      `lantern ${lantern.id}'s radius on the tick after Glass rose to 2`,
    );
    assertNear(
      orbitOf(resized, lantern),
      (ROW.orbit ?? NaN) * scale,
      POSITION_TOL,
      `lantern ${lantern.id}'s orbit on the tick after Glass rose to 2`,
    );
  }
});
