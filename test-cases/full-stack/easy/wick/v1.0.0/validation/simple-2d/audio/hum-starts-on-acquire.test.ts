// Wick — audio/hum-starts-on-acquire: `hum` is looping on the frame after Halo
// enters a weapon slot on `playing`, and is not looping before.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`hum` | `CUES.hum` | Loops while Halo or Corona is
//     held on `playing`".
//   - specs/ui.md (The loops): "`hum` is looping on every frame exactly when
//     `screen` is `playing` and a held weapon is `halo` or `corona`. It starts
//     on the frame that first makes both true, whether Halo was just acquired
//     or play just resumed", and "Both loops are reconciled from the state on
//     every frame".
//   - specs/instrumentation.md (`setWeapon`): "Puts weapon `id` ... at `level`
//     in `slot`"; a pose "sounds nothing", so the loop starts from a frame and
//     never from the call.
//
// WHAT IS READ. `looping("hum")` on a `playing` run with no weapon held, which
// is `false`, and again one frame after Halo took the first weapon slot, which
// is `true`. Both readings belong to this one requirement: what makes it a
// start rather than a state is that the first read was `false`.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, so nothing on it but the weapon
// slot decides the loop, and one tick first, so the loops have reconciled onto
// the run before the reading that must be `false`. `weaponFire` stays off, so
// Halo's aura pulses nothing and no hit or kill lands beside the reading.
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

it("starts the hum on the frame after Halo enters a slot", async () => {
  isolate(h);
  await h.tick(1);
  assertEqual(h.looping("hum"), false, "hum looping with no weapon held");

  const slot = holdWeapon(h, "halo", 1);
  const after = await captureReplay(h, "started", () => h.tick(1));

  assertEqual(after.run.weapons[slot]?.id, "halo", "the weapon in the slot");
  assertEqual(
    h.looping("hum"),
    true,
    "hum looping on the frame after Halo was acquired",
  );
});
