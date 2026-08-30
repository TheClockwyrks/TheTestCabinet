// Meltdown — mazing/occupied-tile-refused: a footprint over another tower is
// refused.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint overlapping a placed tower by a single tile reads invalid.

import { it } from "vitest";

it("A footprint over another tower is refused", () => {
  throw new Error(
    "Meltdown: validation/mazing/occupied-tile-refused.test.ts is not implemented yet",
  );
});
