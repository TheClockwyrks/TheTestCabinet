// Meltdown — modes/bottleneck-allows-inside: bottleneck allows a footprint
// inside the zone.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint wholly inside the zone reads valid and places, and the floor
//   outside stays open for the surge.

import { it } from "vitest";

it("Bottleneck allows a footprint inside the zone", () => {
  throw new Error(
    "Meltdown: validation/modes/bottleneck-allows-inside.test.ts is not implemented yet",
  );
});
