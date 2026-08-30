// Meltdown — floor/grid-visible: the tile grid is always visible.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The floor carries a grid a player can read tiles from, drawn over the
//   floor at all times including with no tower placed.

import { it } from "vitest";

it("The tile grid is always visible", () => {
  throw new Error(
    "Meltdown: validation/floor/grid-visible.test.ts is not implemented yet",
  );
});
