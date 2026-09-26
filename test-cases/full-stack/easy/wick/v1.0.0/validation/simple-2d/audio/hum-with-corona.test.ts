// Wick — audio/hum-with-corona: with Corona held on `playing`, `hum` is
// looping, and it stops on the frame after Corona is removed.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`hum` is looping on every frame exactly when
//     `screen` is `playing` and a held weapon is `halo` or `corona` ... and it
//     stops on the frame either stops being true".
//   - specs/ui.md (Audio): "`hum` | Loops while Halo or Corona is held on
//     `playing`".
//   - specs/evolutions.md (Corona): "Corona keeps the `hum` loop that Halo
//     carried, as `specs/ui.md` states".
//   - specs/instrumentation.md (`setWeapon`): `level` "is `1` ... for an
//     evolved one"; a pose "sounds nothing".
//
// WHAT IS READ. `looping("hum")` one frame after Corona took the first weapon
// slot, which is `true`, and again one frame after the slot was emptied, which
// is `false`. Corona is its own point beside Halo's, because a build that
// carries the hum for the base weapon alone and drops it the moment the weapon
// evolves must grade differently from one that keeps it.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field
// and every driver switch off, holding Corona alone and never Halo, so the loop
// can only be answering the evolved weapon. Corona is placed through the
// surface rather than reached through a chest, because a build with a broken
// evolution must fail the evolution points and this one is about the loop.
// `weaponFire` stays off, so the aura pulses nothing and no kill or heal lands
// beside the reading.
//
// TOLERANCE. None. Both readings are booleans.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the hum under Corona and drops it when Corona goes", async () => {
  isolate(h);
  const slot = holdWeapon(h, "corona", 1);

  const held = await captureReplay(h, "corona", async () => {
    const on = await h.tick(1);
    assertEqual(on.run.weapons[slot]?.id, "corona", "the weapon in the slot");
    assertEqual(h.looping("hum"), true, "hum looping with Corona held");
    h.debug.removeWeapon(slot);
    return h.tick(1);
  });

  assertEqual(held.run.weapons.length, 0, "the weapons held after the removal");
  assertEqual(
    h.looping("hum"),
    false,
    "hum looping on the frame after Corona was removed",
  );
});
