// Meltdown — building/refund-includes-upgrades: the refund is on everything
// spent.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower taken to level III refunds against its build cost plus both
//   upgrade costs.

import { it } from "vitest";

it("The refund is on everything spent", () => {
  throw new Error(
    "Meltdown: validation/building/refund-includes-upgrades.test.ts is not implemented yet",
  );
});
