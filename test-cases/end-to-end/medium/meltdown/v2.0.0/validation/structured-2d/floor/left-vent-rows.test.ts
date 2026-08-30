// Meltdown — floor/left-vent-rows: the left vent opens on rows 16 to 19.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit added at the left vent enters on one of tiles (0, 16) through (0,
//   19) and on no other.

import { it } from "vitest";

it("The left vent opens on rows 16 to 19", () => {
  throw new Error(
    "Meltdown: validation/floor/left-vent-rows.test.ts is not implemented yet",
  );
});
