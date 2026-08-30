// Meltdown — economy/cannot-overspend-on-a-build: a build never overspends.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A placement costing more than the money on hand reads invalid, builds
//   nothing and spends nothing.

import { it } from "vitest";

it("A build never overspends", () => {
  throw new Error(
    "Meltdown: validation/economy/cannot-overspend-on-a-build.test.ts is not implemented yet",
  );
});
