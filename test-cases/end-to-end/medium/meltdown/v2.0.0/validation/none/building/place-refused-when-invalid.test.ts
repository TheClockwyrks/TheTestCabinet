// Meltdown — building/place-refused-when-invalid: an invalid placement builds
// nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   place on an invalid footprint adds no tower, blocks no tile and spends
//   nothing.

import { it } from "vitest";

it("An invalid placement builds nothing", () => {
  throw new Error(
    "Meltdown: validation/building/place-refused-when-invalid.test.ts is not implemented yet",
  );
});
