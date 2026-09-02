// instrumentation/set-weapon-rejects-evolution-pair — with Pyre held in slot
// 0, `setWeapon(1, 'taper', 1)` throws; with Taper held in slot 0,
// `setWeapon(1, 'pyre', 1)` throws; each leaves the loadout as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, `setWeapon`:
// "Invalid: ... a base weapon whose evolution is held in another slot; an
// evolved weapon whose base is held in another slot". specs/evolutions.md:
// Pyre is Taper's evolution.
//
// THE POSE. Two scenes, each an isolated run with the one weapon in slot 0,
// the refused pose into slot 1, and the whole snapshot against the reading
// before.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import type { WeaponId } from "../constants";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

const PAIRS: readonly { held: WeaponId; posed: WeaponId }[] = [
  { held: "pyre", posed: "taper" },
  { held: "taper", posed: "pyre" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a base beside its evolution and an evolution beside its base", async () => {
  for (const { held, posed } of PAIRS) {
    isolate(h);
    holdWeapon(h, held, 1);
    const before = h.snapshot();

    assertThrows(
      () => h.debug.setWeapon(1, posed, 1),
      `setWeapon(1, '${posed}', 1) with ${held} held`,
    );
    assertDeepEqual(
      h.snapshot(),
      before,
      `the snapshot across the refused ${posed}`,
    );
  }
  await h.tick(1);
  captureStill(h, "refused");
});
