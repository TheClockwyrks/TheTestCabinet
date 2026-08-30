// Meltdown — floor/top-vent-cols: the top vent opens on columns 22 to 29.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit added at the top vent enters on one of tiles (22, 0) through (29,
//   0) and on no other.

import { it } from "vitest";

it("The top vent opens on columns 22 to 29", () => {
  throw new Error(
    "Meltdown: validation/floor/top-vent-cols.test.ts is not implemented yet",
  );
});
