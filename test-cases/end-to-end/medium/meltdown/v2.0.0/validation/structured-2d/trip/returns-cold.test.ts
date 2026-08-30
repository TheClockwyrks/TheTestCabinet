// Meltdown — trip/returns-cold: it comes back online cold.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   After 5.0 seconds the tower reports tripped false and heat 0.

import { it } from "vitest";

it("It comes back online cold", () => {
  throw new Error(
    "Meltdown: validation/trip/returns-cold.test.ts is not implemented yet",
  );
});
