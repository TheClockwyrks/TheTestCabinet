// Meltdown — towers/rotation-turns-the-faces: rotation turns the radiator
// faces.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   An Arc placed at rotation 1 reports world radiator faces E and W where
//   rotation 0 reports N and S.

import { it } from "vitest";

it("Rotation turns the radiator faces", () => {
  throw new Error(
    "Meltdown: validation/towers/rotation-turns-the-faces.test.ts is not implemented yet",
  );
});
