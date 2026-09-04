// instrumentation/set-weapon-level-above-max — setWeapon refuses a base weapon
// above its top level, throws, and leaves the state exactly as it was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant; no operation rounds,
// clamps, or otherwise normalizes an argument."
// `setWeapon(slot, id, level)`: "`level` is `1` to `MAX_WEAPON_LEVEL` for a
// base weapon", and `MAX_WEAPON_LEVEL` is `8`, so `9` is one past the top.
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

it("refuses setWeapon(0, 'taper', 9) and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  assertThrows(
    () => debug.setWeapon(0, "taper", 9),
    "setWeapon(0, 'taper', 9)",
  );
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after setWeapon(0, 'taper', 9) was refused",
  );

  await h.tick(1);
  captureStill(h, "refused");
});
