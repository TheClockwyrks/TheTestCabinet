// Meltdown — floor/bottom-exhaust-cols: the bottom exhaust opens on columns 22
// to 29.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit walking to the bottom exhaust leaves the floor from one of tiles
//   (22, 35) through (29, 35), and one held against the bottom casing outside
//   those columns does not leave.

import { it } from "vitest";

it("The bottom exhaust opens on columns 22 to 29", () => {
  throw new Error(
    "Meltdown: validation/floor/bottom-exhaust-cols.test.ts is not implemented yet",
  );
});
