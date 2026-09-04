// Wick — evolutions/corona-replaces-halo-zone: Corona's first tick removes the
// Halo aura and creates its own.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Corona"): "On the first `playing` tick Corona is
//     held and no Corona aura exists, the Halo aura zone is removed and the
//     Corona zone is created with a fresh id".
//   - `specs/evolutions.md` ("Corona"): "one zone of kind `aura`", so exactly
//     one aura stands after the replacement.
//   - `specs/world.md` ("One tick"), phase 5: "The placement, on every
//     `playing` tick: an aura or a lantern set is created on a tick its weapon
//     is held and none exists, and removed on a tick its weapon is no longer
//     held"; `specs/instrumentation.md` (The driver switches): "Placement is
//     gated by neither `weaponFire` nor `effectMotion`".
//   - `specs/instrumentation.md` (`setWeapon`): "Nothing else changes: the aura
//     of Halo or Corona ... appear on the next `playing` tick under the
//     placement rule", so the replacement is the tick's doing.
//   - `specs/state.md` (`ZoneState`): `weapon` is "the weapon that produced it"
//     and `id` is "unique for the run, assigned from `nextId`", so a zone whose
//     id is at least the `nextId` read before the tick is one that tick made.
//
// WHAT IS READ. After the tick that follows putting Corona in Halo's slot: no
// aura with weapon `halo` stands; exactly one aura stands in all; its `weapon`
// reads `corona`; and its id is at least the `nextId` read before the tick. A
// build that keeps the Halo aura shows two, and one that re-labels the same
// zone shows the old id.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo at level 1 first, so an aura of its own
// is live when Corona arrives; Corona placed in that same slot; every driver
// switch off, since the placement needs none of them and no pulse is wanted;
// nothing else on the field, so the auras are the only zones that can exist.
//
// TOLERANCE. None: a zone is in `zones` or it is not, and an id is a whole
// number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOfKind,
  type Harness,
} from "../harness";
import { coronaAuras, haloAuras } from "./corona";

/** The level Halo is held at: any row serves, and row 1 is the acquisition row. */
const HALO_LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes the Halo aura and stands one fresh Corona aura in its place", async () => {
  isolate(h);
  const slot = holdWeapon(h, "halo", HALO_LEVEL);

  const placed = await h.tick(1);
  assertEqual(haloAuras(placed).length, 1, "Halo auras before Corona is held");

  h.debug.setWeapon(slot, "corona", 1);
  const freshFrom = h.snapshot().run.nextId;

  const after = await h.tick(1);
  captureStill(h, "replaced");

  assertEqual(
    haloAuras(after).length,
    0,
    "Halo auras after the first playing tick Corona is held",
  );
  assertEqual(
    zonesOfKind(after, "aura").length,
    1,
    "aura zones of any weapon after that tick",
  );
  const auras = coronaAuras(after);
  assertEqual(auras.length, 1, "Corona auras after that tick");
  assertGreaterThanOrEqual(
    auras[0].id,
    freshFrom,
    "the Corona aura's id against the nextId before the tick, a fresh id",
  );
});
