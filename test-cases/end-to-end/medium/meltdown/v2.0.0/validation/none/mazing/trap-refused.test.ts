// Meltdown — mazing/trap-refused: trapping a unit is refused.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint that would leave a unit already on the floor with no route to
//   its assigned exhaust reads invalid and place builds nothing.

import { it } from "vitest";

it("Trapping a unit is refused", () => {
  throw new Error(
    "Meltdown: validation/mazing/trap-refused.test.ts is not implemented yet",
  );
});
