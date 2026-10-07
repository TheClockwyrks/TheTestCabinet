// instrumentation/spawn-projectile-unknown-weapon — spawnProjectile refuses a
// weapon that fires no projectile, throws, and leaves the state exactly as it
// was.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, "The operations":
// "An argument outside the domain its operation states is invalid, and the
// call throws rather than guessing what was meant; no operation rounds,
// clamps, or otherwise normalizes an argument."
// `spawnProjectile(weapon, x, y, vx, vy, pierce)`: `weapon` is "one of
// `ember`, `pin`, `shard`, `sconce`, `beacon`, and `hail`", and Taper is a
// slash rather than any of them.
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

it("refuses spawnProjectile('taper', 0, 0, 1, 0, 0) and changes nothing", async () => {
  const before = isolate(h, { keepTaper: true });
  const debug = h.debug as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  assertThrows(
    () => debug.spawnProjectile("taper", 0, 0, 1, 0, 0),
    "spawnProjectile('taper', 0, 0, 1, 0, 0)",
  );
  assertDeepEqual(
    h.snapshot(),
    before,
    "the snapshot after spawnProjectile('taper', 0, 0, 1, 0, 0) was refused",
  );

  await h.tick(1);
  captureStill(h, "refused");
});
