// Meltdown — combat/range-from-the-footprint-centre: range is measured from
// the footprint centre.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A 4x4 Lance's radius is measured from the centre of its sixteen tiles, so
//   a unit is in range on the far side and out on the near one at the same
//   distance from its anchor tile.

import { it } from "vitest";

it("Range is measured from the footprint centre", () => {
  throw new Error(
    "Meltdown: validation/combat/range-from-the-footprint-centre.test.ts is not implemented yet",
  );
});
