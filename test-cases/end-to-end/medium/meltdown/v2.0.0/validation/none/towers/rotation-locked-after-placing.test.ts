// Meltdown — towers/rotation-locked-after-placing: orientation is fixed at
// placement.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A placed tower's rotation and radiatorFaces do not change when the held
//   preview is rotated afterwards.

import { it } from "vitest";

it("Orientation is fixed at placement", () => {
  throw new Error(
    "Meltdown: validation/towers/rotation-locked-after-placing.test.ts is not implemented yet",
  );
});
