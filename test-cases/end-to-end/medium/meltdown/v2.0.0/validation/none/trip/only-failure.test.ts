// Meltdown — trip/only-failure: the trip is the only failure.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower held under a wave of forty units for a minute is never destroyed,
//   never damaged, never runs out of ammo, and its only offline periods are
//   trip cooldowns.

import { it } from "vitest";

it("The trip is the only failure", () => {
  throw new Error(
    "Meltdown: validation/trip/only-failure.test.ts is not implemented yet",
  );
});
