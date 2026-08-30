// Meltdown — building/preview-valid-on-open-floor: a buildable footprint reads
// valid.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint on open, affordable floor inside any build zone reads valid.

import { it } from "vitest";

it("A buildable footprint reads valid", () => {
  throw new Error(
    "Meltdown: validation/building/preview-valid-on-open-floor.test.ts is not implemented yet",
  );
});
