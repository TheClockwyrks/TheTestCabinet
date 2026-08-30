// Meltdown — building/preview-invalid-when-unaffordable: an unaffordable
// footprint reads invalid.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With money one below the tower's cost the footprint reads invalid.

import { it } from "vitest";

it("An unaffordable footprint reads invalid", () => {
  throw new Error(
    "Meltdown: validation/building/preview-invalid-when-unaffordable.test.ts is not implemented yet",
  );
});
