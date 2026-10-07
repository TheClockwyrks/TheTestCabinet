// evolutions/corona-replaces-halo-zone — Corona's first tick replaces the Halo
// aura.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Corona"): "On the
// first `playing` tick Corona is held and no Corona aura exists, the Halo aura
// zone is removed and the Corona zone is created with a fresh id". A fresh id
// is one at or above the `nextId` the snapshot reported before the tick
// (`specs/instrumentation.md`: "A pose that creates an entity gives it the
// next id from `nextId`"), and `specs/state.md` (`ZoneState`) has each zone
// carry the `weapon` "that produced it" — so after that tick no zone reads
// `halo`, exactly one zone of kind `aura` stands, and it reads `corona` under
// an id the Halo aura never held.
//
// HOW THE HALO AURA IS PUT IN THE WORLD FIRST. Halo is held and one tick is
// run: its aura is created "on the first `playing` tick Halo is held and none
// exists" (`specs/weapons.md`, Halo) through the placement part of phase 5,
// which runs "on every `playing` tick" whatever the switches hold
// (`specs/instrumentation.md`). `weaponFire` stays off throughout, so neither
// aura pulses and no enemy is needed: what is read is the placement alone.
// Corona then takes Halo's own slot through `setWeapon`, which is what the
// evolution does — "The evolved weapon replaces its base in the same slot"
// (`specs/evolutions.md`, Opening a chest).
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but that
// one weapon slot, every driver switch off, so no other weapon places a zone
// and nothing else could account for what stands after the tick.
//
// THE TOLERANCE. None: zone counts, a weapon name and an id are read exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  zonesOf,
  zonesOfKind,
  type Harness,
} from "../harness";
import { theZone } from "./evolved";

/** The Halo level held first; any row places one aura. */
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
  const placed = await advanceTicks(h, 1);
  assertEqual(
    zonesOf(placed, "halo").length,
    1,
    "the Halo aura standing before Corona is held (specs/weapons.md, Halo)",
  );

  h.debug.setWeapon(slot, "corona", 1);
  const before = h.snapshot();

  const after = await advanceTicks(h, 1);
  captureStill(h, "replaced");

  assertEqual(
    zonesOf(after, "halo").length,
    0,
    "the zones with weapon halo after the first tick Corona is held (specs/evolutions.md, Corona)",
  );
  assertEqual(
    zonesOfKind(after, "aura").length,
    1,
    "the aura zones standing after that tick (specs/evolutions.md, Corona)",
  );
  const aura = theZone(after, "corona", "aura");
  assertGreaterThanOrEqual(
    aura.id,
    before.run.nextId,
    "the Corona aura's id, which must be fresh rather than the Halo aura's (specs/evolutions.md, Corona)",
  );
});
