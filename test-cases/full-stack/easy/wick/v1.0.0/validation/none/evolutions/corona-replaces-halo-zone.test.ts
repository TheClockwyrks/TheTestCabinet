// Wick — evolutions/corona-replaces-halo-zone: Corona's first tick replaces the
// Halo aura with one of its own.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "On the
// first `playing` tick Corona is held and no Corona aura exists, the Halo aura
// zone is removed and the Corona zone is created with a fresh id", over "one
// zone of kind `aura`". So on that tick no zone of kind `aura` carries weapon
// `halo`, exactly one carries weapon `corona`, and its id is one no zone held
// before the tick.
//
// THE POSE. An isolated night, Halo held at level 1 through `setWeapon` and one
// tick to place its aura — `specs/weapons.md` ("Halo"): "The zone is created on
// the first `playing` tick Halo is held and none exists", and
// `specs/instrumentation.md` has "Placement ... gated by neither `weaponFire`
// nor `effectMotion`", so it appears with every switch off and pulses on
// nothing. Then Halo's slot is emptied through `removeWeapon` and Corona is
// placed through `setWeapon`: the two cannot be held at once, since `setWeapon`
// calls "an evolved weapon whose base is held in another slot" invalid. Neither
// pose ticks, so the Halo aura is still in the world when the next tick runs,
// which is the state the rule is written over.
//
// TOLERANCE. None: the aura count, its weapon, and the freshness of its id are
// exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
  zonesOfKind,
} from "../harness";
import { soleAura } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the Halo aura and holds one fresh Corona aura on the first tick Corona is held", async () => {
  await isolate(h);
  const haloSlot = await holdWeapon(h, "halo", 1);
  const lit = await h.step(1);
  const halo = soleAura(lit, "on the first tick Halo is held");
  assertEqual(halo.weapon, "halo", "the aura's weapon while Halo is held");

  await h.debug.removeWeapon(haloSlot);
  await holdWeapon(h, "corona", 1);
  const before = await h.snapshot();
  const swapped = await h.step(1);
  await captureStill(h, "replaced");

  const aura = soleAura(swapped, "on the first tick Corona is held");
  assertEqual(aura.weapon, "corona", "the aura's weapon after the swap");
  assertTrue(
    aura.id !== halo.id,
    `the Corona aura carries a fresh id, not the Halo aura's (${halo.id})`,
  );
  assertTrue(
    aura.id >= before.run.nextId,
    `the Corona aura's id (${aura.id}) is one the tick created, at or past nextId (${before.run.nextId})`,
  );
  assertEqual(
    zonesOfKind(swapped, "aura").filter((zone) => zone.weapon === "halo")
      .length,
    0,
    "aura zones still carrying weapon halo",
  );
});
