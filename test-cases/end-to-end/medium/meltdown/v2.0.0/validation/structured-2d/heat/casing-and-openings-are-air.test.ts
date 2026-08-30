// Meltdown — heat/casing-and-openings-are-air: the casing and the openings
// shed as air.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A face flush against the casing, and a face across a vent opening, each
//   shed exactly what a face on open floor sheds.

import { it } from "vitest";

it("The casing and the openings shed as air", () => {
  throw new Error(
    "Meltdown: validation/heat/casing-and-openings-are-air.test.ts is not implemented yet",
  );
});
