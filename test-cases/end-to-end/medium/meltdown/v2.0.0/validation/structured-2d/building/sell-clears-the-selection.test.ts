// Meltdown — building/sell-clears-the-selection: selling the selected tower
// deselects.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Selling the tower that was selected leaves selected null, and selling a
//   different tower leaves the selection where it was.

import { it } from "vitest";

it("Selling the selected tower deselects", () => {
  throw new Error(
    "Meltdown: validation/building/sell-clears-the-selection.test.ts is not implemented yet",
  );
});
