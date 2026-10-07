// instrumentation/set-weapon-appends — with Taper alone held,
// `setWeapon(1, 'ember', 3)` reads back weapons as Taper then Ember at level 3
// with cooldown 0.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The loadout": "a
// placement in slot `weapons.length` appends"; `setWeapon`: "Puts weapon
// `id`, a `WeaponId`, at `level` in `slot`. `slot` is `0` to `weapons.length`
// ... When the slot's `id` changes its cooldown timer becomes `0`".
//
// THE POSE. An isolated run keeping its Taper in slot 0, the pose into slot
// 1, read back without a frame.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("appends Ember after Taper", async () => {
  const posed = isolate(h, { keepTaper: true });
  assertDeepEqual(
    posed.run.weapons.map((w) => w.id),
    ["taper"],
    "Taper alone held",
  );

  h.debug.setWeapon(1, "ember", 3);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "appended");

  assertDeepEqual(
    s.run.weapons,
    [
      { id: "taper", level: 1, cooldown: 0 },
      { id: "ember", level: 3, cooldown: 0 },
    ],
    "weapons after the append",
  );
});
