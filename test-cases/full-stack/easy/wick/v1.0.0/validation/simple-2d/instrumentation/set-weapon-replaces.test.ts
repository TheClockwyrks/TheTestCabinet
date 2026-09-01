// instrumentation/set-weapon-replaces — with Taper in slot 0,
// `setWeapon(0, 'pin', 2)` reads back Pin at level 2 in slot 0 and no Taper
// anywhere.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setWeapon`: "Puts
// weapon `id`, a `WeaponId`, at `level` in `slot`. `slot` is `0` to
// `weapons.length`", so a held slot is replaced; "When the slot's `id`
// changes its cooldown timer becomes `0`".
//
// THE POSE. An isolated run keeping its Taper, the pose over slot 0, read
// back without a frame.

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

it("replaces Taper with Pin in slot 0", async () => {
  const posed = isolate(h, { keepTaper: true });
  assertDeepEqual(
    posed.run.weapons.map((w) => w.id),
    ["taper"],
    "Taper in slot 0",
  );

  h.debug.setWeapon(0, "pin", 2);
  const s = h.snapshot();
  await h.tick(1);
  captureStill(h, "replaced");

  assertDeepEqual(
    s.run.weapons,
    [{ id: "pin", level: 2, cooldown: 0 }],
    "weapons after the replacement: Pin alone, Taper gone",
  );
});
