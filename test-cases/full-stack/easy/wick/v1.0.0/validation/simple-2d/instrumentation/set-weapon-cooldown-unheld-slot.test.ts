// instrumentation/set-weapon-cooldown-unheld-slot — setWeaponCooldown refuses
// a slot holding no weapon, throws, and leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant; no operation rounds,
// clamps, or otherwise normalizes an argument."
// `setWeaponCooldown(slot, seconds)`: `slot` is "a held slot", and with one
// weapon held, slot `3` holds none.
//
// The comparison across the refused call is exact equality of the state a pose
// governs. Every other refusal the specification states is a point of its own.
//
// WHY THE WORLD IS POSED AS IT IS. The fresh run's Taper is kept as the one
// held weapon, so slot 3 is empty and slot 0 is held, and no passive is held;
// the argument is the nearest figure outside its domain, so a build that clamps
// lands on a valid value and changes the state, which is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertThrows } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses setWeaponCooldown(3, 0) and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  assertThrows(() => debug.setWeaponCooldown(3, 0), "setWeaponCooldown(3, 0)");
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setWeaponCooldown(3, 0) was refused",
  );

  await h.tick(1);
  captureStill(h, "refused");
});
