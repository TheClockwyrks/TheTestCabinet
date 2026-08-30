// Meltdown — floor/right-exhaust-rows: the right exhaust opens on rows 16 to
// 19.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit walking to the right exhaust leaves the floor from one of tiles
//   (49, 16) through (49, 19), and one held against the right casing outside
//   those rows does not leave.

import { it } from "vitest";

it("The right exhaust opens on rows 16 to 19", () => {
  throw new Error(
    "Meltdown: validation/floor/right-exhaust-rows.test.ts is not implemented yet",
  );
});
