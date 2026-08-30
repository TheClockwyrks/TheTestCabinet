// Meltdown — mazing/seal-refused: a sealing placement is refused.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A footprint that would leave the left vent with no route to the right
//   exhaust reads invalid and place builds nothing.

import { it } from "vitest";

it("A sealing placement is refused", () => {
  throw new Error(
    "Meltdown: validation/mazing/seal-refused.test.ts is not implemented yet",
  );
});
