// Meltdown — presentation/valid-and-invalid-previews-read-apart: a refused
// footprint reads refused.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A valid preview footprint and an invalid one are drawn plainly apart.

import { it } from "vitest";

it("A refused footprint reads refused", () => {
  throw new Error(
    "Meltdown: validation/presentation/valid-and-invalid-previews-read-apart.test.ts is not implemented yet",
  );
});
