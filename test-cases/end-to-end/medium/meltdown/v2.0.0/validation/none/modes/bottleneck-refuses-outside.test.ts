// Meltdown — modes/bottleneck-refuses-outside: bottleneck refuses a footprint
// outside the zone.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint with a single tile outside the zone reads invalid and builds
//   nothing.

import { it } from "vitest";

it("Bottleneck refuses a footprint outside the zone", () => {
  throw new Error(
    "Meltdown: validation/modes/bottleneck-refuses-outside.test.ts is not implemented yet",
  );
});
