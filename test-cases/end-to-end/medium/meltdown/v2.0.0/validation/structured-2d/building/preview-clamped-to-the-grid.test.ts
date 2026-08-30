// Meltdown — building/preview-clamped-to-the-grid: the preview stays on the
// grid.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A pointer at each of the floor's four corners leaves the whole footprint
//   on the grid, at 2x2 and 4x4.

import { it } from "vitest";

it("The preview stays on the grid", () => {
  throw new Error(
    "Meltdown: validation/building/preview-clamped-to-the-grid.test.ts is not implemented yet",
  );
});
