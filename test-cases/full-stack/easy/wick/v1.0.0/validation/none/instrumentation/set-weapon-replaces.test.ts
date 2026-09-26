// Wick — instrumentation/set-weapon-replaces: with Taper in slot 0,
// `setWeapon(0, "pin", 2)` reads back Pin at level 2 in slot 0 and no Taper
// anywhere.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md —
// `setWeapon(slot, id, level)`): "Puts weapon `id`, a `WeaponId`, at `level`
// in `slot`. `slot` is `0` to `weapons.length`" — a held slot takes the new
// weapon in place of the old — and "When the slot's `id` changes its cooldown
// timer becomes `0`".
//
// WHY THE WORLD IS POSED AS IT IS. The fresh run's Taper is the one held slot,
// so the pose is a replacement and not an append, and a build that appended
// instead would read two weapons.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  FRESH_TAPER,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("replaces the weapon in a held slot", async () => {
  const posed = await isolate(h, { taper: true });
  assertDeepEqual(
    posed.run.weapons,
    [FRESH_TAPER],
    "the weapons before the pose",
  );

  await h.debug.setWeapon(0, "pin", 2);
  const after = await h.snapshot();
  await captureStill(h, "replaced");
  assertDeepEqual(
    after.run.weapons,
    [{ id: "pin", level: 2, cooldown: 0 }],
    "the weapons after setWeapon(0, 'pin', 2)",
  );
});
