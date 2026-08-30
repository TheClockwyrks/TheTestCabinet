// Meltdown — mazing/tile-under-a-unit-refused: a footprint over a unit is
// refused.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint containing the tile a unit's centre currently occupies reads
//   invalid.

import { it } from "vitest";

it("A footprint over a unit is refused", () => {
  throw new Error(
    "Meltdown: validation/mazing/tile-under-a-unit-refused.test.ts is not implemented yet",
  );
});
