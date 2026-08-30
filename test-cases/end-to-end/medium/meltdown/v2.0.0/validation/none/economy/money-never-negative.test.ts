// Meltdown — economy/money-never-negative: money never falls below zero.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Across a session of building, upgrading and selling at the edge of
//   affordability, money is never negative.

import { it } from "vitest";

it("Money never falls below zero", () => {
  throw new Error(
    "Meltdown: validation/economy/money-never-negative.test.ts is not implemented yet",
  );
});
