// Meltdown — trip/does-not-trip-in-the-plateau: the plateau is safe.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower held anywhere from its redline to 99 keeps firing and never
//   reports tripped.

import { it } from "vitest";

it("The plateau is safe", () => {
  throw new Error(
    "Meltdown: validation/trip/does-not-trip-in-the-plateau.test.ts is not implemented yet",
  );
});
