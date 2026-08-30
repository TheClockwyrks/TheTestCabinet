// Meltdown — floor/casing-not-buildable: the casing cannot be built on.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A preview footprint covering any casing tile reads invalid and place
//   builds nothing.

import { it } from "vitest";

it("The casing cannot be built on", () => {
  throw new Error(
    "Meltdown: validation/floor/casing-not-buildable.test.ts is not implemented yet",
  );
});
