// Meltdown — building/sell-reopens-and-repaths: selling reopens the footprint.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Every tile of the sold footprint is open on the frame the sale lands and
//   paths.left.length is recomputed. A footprint cannot read open while its
//   tower stands, so this is also what decides that the sold tower leaves the
//   roster.

import { it } from "vitest";

it("Selling reopens the footprint", () => {
  throw new Error(
    "Meltdown: validation/building/sell-reopens-and-repaths.test.ts is not implemented yet",
  );
});
