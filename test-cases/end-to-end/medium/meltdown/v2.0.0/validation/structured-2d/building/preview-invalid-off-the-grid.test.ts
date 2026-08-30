// Meltdown — building/preview-invalid-off-the-grid: a footprint off the grid
// reads invalid.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A preview whose footprint would run past the floor's edge reads invalid
//   rather than being placed clipped.

import { it } from "vitest";

it("A footprint off the grid reads invalid", () => {
  throw new Error(
    "Meltdown: validation/building/preview-invalid-off-the-grid.test.ts is not implemented yet",
  );
});
