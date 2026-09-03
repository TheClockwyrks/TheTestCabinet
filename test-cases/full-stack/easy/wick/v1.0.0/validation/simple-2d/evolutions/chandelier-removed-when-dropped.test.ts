// Wick — evolutions/chandelier-removed-when-dropped: the set is removed on the
// next `playing` tick Chandelier is no longer held.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"): "The set is removed on the next
//     `playing` tick Chandelier is no longer held."
//   - `specs/world.md` ("One tick"), phase 5: the placement runs "on every
//     `playing` tick: an aura or a lantern set is created on a tick its weapon
//     is held and none exists, and removed on a tick its weapon is no longer
//     held"; `specs/instrumentation.md` (The driver switches): "Placement is
//     gated by neither `weaponFire` nor `effectMotion`".
//   - `specs/instrumentation.md` (`removeWeapon`): "Removes the weapon in
//     `slot`, a held slot. Its aura or lantern set is removed on the next
//     `playing` tick under the placement rule".
//
// WHAT IS READ. After the tick following `removeWeapon`: no zone of kind
// `lantern` stands, with the tick before it holding the four the placement
// created. A build that leaves a dropped weapon's set in the world keeps them.
//
// WHY THE NIGHT IS POSED AS IT IS. Chandelier alone, so the only lantern zones
// that can exist are its own and the reading needs no filter by weapon; nothing
// on the field and every driver switch off, since the placement is the only
// faculty this item concerns.
//
// TOLERANCE. None: a zone is in `zones` or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CHANDELIER_STATS } from "../constants";
import {
  captureStill,
  createHarness,
  zonesOfKind,
  type Harness,
} from "../harness";
import { poseEvolved } from "./evolved";
import { chandelierLanterns } from "./chandelier";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds no lantern zone on the tick after Chandelier is removed", async () => {
  const { slot } = poseEvolved(h, "chandelier");

  const placed = await h.tick(1);
  assertEqual(
    chandelierLanterns(placed).length,
    CHANDELIER_STATS.amount,
    "Chandelier lanterns after the placing tick",
  );

  h.debug.removeWeapon(slot);
  const after = await h.tick(1);
  captureStill(h, "removed");

  assertEqual(after.run.weapons.length, 0, "weapons held after removeWeapon");
  assertEqual(
    zonesOfKind(after, "lantern").length,
    0,
    "lantern zones after the tick following removeWeapon",
  );
});
