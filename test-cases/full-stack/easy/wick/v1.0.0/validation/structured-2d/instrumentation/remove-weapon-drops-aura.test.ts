// Wick — instrumentation/remove-weapon-drops-aura: with Halo held and its
// aura live, `removeWeapon` on Halo's slot leaves the aura gone after the
// next `playing` tick, while the puddles and bolts other weapons produced
// stay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `removeWeapon(slot)`: "Its aura or lantern set is removed on the next
// `playing` tick under the placement rule; the projectiles and other zones it
// produced stay." `specs/world.md`, phase 5, placement: "removed on a tick its
// weapon is no longer held".
//
// THE DRIVE. An isolated run, Halo held, one tick so the aura exists; a
// posed Oil Splash puddle and a posed Ember bolt (their weapons not held,
// which is the placement rule's concern for neither); the removal, read at
// the call (the aura still there) and after one tick (gone, the other two
// still there).

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertLength } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  placeProjectile,
  placePuddle,
  projectileById,
  zoneById,
  zonesOfKind,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the aura on the next tick and keeps the rest", async () => {
  isolate(h);
  const halo = holdWeapon(h, "halo");
  const lit = await advanceTicks(h, 1);
  assertLength(zonesOfKind(lit, "aura"), 1, "the aura before the removal");
  const puddle = placePuddle(h, "oil-splash", 200, 200);
  const bolt = placeProjectile(h, "ember", -200, 0, 0, 0, 0);

  h.debug.removeWeapon(halo);
  assertLength(
    zonesOfKind(h.snapshot(), "aura"),
    1,
    "the aura at the call, before the placement tick",
  );
  const after = await advanceTicks(h, 1);
  captureStill(h, "dropped");
  assertLength(
    zonesOfKind(after, "aura"),
    0,
    "auras after the next playing tick",
  );
  assertDefined(zoneById(after, puddle), "the puddle after the removal");
  assertDefined(projectileById(after, bolt), "the bolt after the removal");
});
