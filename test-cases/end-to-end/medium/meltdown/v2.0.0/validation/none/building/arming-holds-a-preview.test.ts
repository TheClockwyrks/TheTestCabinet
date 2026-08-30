// Meltdown — building/arming-holds-a-preview: arming holds a preview.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   setArmed("arc") reports build carrying that type, a footprint, a rotation
//   and a validity, and setArmed(null) clears it.

import { it } from "vitest";

it("Arming holds a preview", () => {
  throw new Error(
    "Meltdown: validation/building/arming-holds-a-preview.test.ts is not implemented yet",
  );
});
