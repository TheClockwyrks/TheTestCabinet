// Wick — passives/glass-fixed-after-creation: a shape's lengths are fixed when
// it is created, so a Glass level gained later leaves a live shape as it was.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md` ("Area"): "A shape's
// lengths are fixed when it is created, with one exception: the Halo and Corona
// aura's radius and a Chandelier lantern's orbit and radius are recomputed on
// every tick". `specs/weapons.md` ("Lantern") says the same of a set: "`orbit`
// and `radius` are fixed when the set is created." So a puddle at radius `50`,
// a bolt at radius `8`, and a lantern at radius `14` on a circle of `90`, each
// created while no Glass is held, still read those figures on the tick after
// Glass rises to level 2, where a shape created then would read `60`, `9.6`,
// `16.8`, and `108`.
//
// THE POSE. An isolated night with no passive held. Ember, Oil Splash, and
// Lantern are held at level 1 and fired by one tick together, so all three
// shapes are created under `areaMul` `1`; Ember "needs at least one enemy to
// fire", so one hound stands `FAR` (`5000`) units along `+x`, past every reach.
// `weaponFire` is then turned back off, so no second firing creates a shape
// under the new level, and Glass 2 is placed through `setPassive` before one
// more tick runs. Every other faculty stays held, so nothing travels and
// nothing revolves; each shape is read back by the id it was created with. The
// three live well past the tick: the bolt's `ttl` is `2.0` seconds, the
// puddle's `2.5`, and the set's `3.0`.
//
// TOLERANCE. `FLOAT_TOL` on each radius and `POSITION_TOL` (`1e-6`) on the
// orbit. A build that resized on the level would be `1.6` to `18` units away on
// each.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, POSITION_TOL, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  disable,
  holdPassive,
  isolate,
  mustProjectile,
  mustZone,
  type Harness,
} from "../harness";
import {
  fireVolley,
  orbitOf,
  placeFarTarget,
  shapesOf,
  shotsOf,
} from "./stage";

/** The Glass level gained while the shapes live: `areaMul` would become `1.2`. */
const GLASS_LEVEL = 2;

/** The level every weapon is held at. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves a live puddle, bolt, and lantern set at their created lengths after Glass rises to 2", async () => {
  await isolate(h);
  await placeFarTarget(h, "hound");

  const volley = await fireVolley(h, [
    { id: "ember", level: LEVEL },
    { id: "oil-splash", level: LEVEL },
    { id: "lantern", level: LEVEL },
  ]);
  await disable(h, "weaponFire");

  const bolts = shotsOf(volley, "ember");
  const puddles = shapesOf(volley, "oil-splash");
  const lanterns = shapesOf(volley, "lantern");
  assertEqual(bolts.length, 1, "Ember bolts the firing tick created");
  assertEqual(puddles.length, 1, "puddles the firing tick created");
  assertEqual(lanterns.length, 1, "lanterns the firing tick created");

  await holdPassive(h, "glass", GLASS_LEVEL);
  const later = await h.step(1);
  await captureStill(h, "fixed");

  assertNear(
    mustProjectile(later, bolts[0]!.id).radius,
    weaponRow("ember", LEVEL).radius ?? NaN,
    FLOAT_TOL,
    "the live bolt's radius on the tick after Glass rose to 2",
  );
  assertNear(
    mustZone(later, puddles[0]!.id).radius,
    weaponRow("oil-splash", LEVEL).radius ?? NaN,
    FLOAT_TOL,
    "the live puddle's radius on the tick after Glass rose to 2",
  );
  assertNear(
    mustZone(later, lanterns[0]!.id).radius,
    weaponRow("lantern", LEVEL).radius ?? NaN,
    FLOAT_TOL,
    "the live lantern's radius on the tick after Glass rose to 2",
  );
  assertNear(
    orbitOf(later, mustZone(later, lanterns[0]!.id)),
    weaponRow("lantern", LEVEL).orbit ?? NaN,
    POSITION_TOL,
    "the live set's orbit on the tick after Glass rose to 2",
  );
});
