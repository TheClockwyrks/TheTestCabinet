// Meltdown — building/sell-refunds-seventy-percent: a tower that has fought
// refunds 70%.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower that is no longer fresh refunds floor(0.7 * spent) and money rises
//   by exactly that.

import { it } from "vitest";

it("A tower that has fought refunds 70%", () => {
  throw new Error(
    "Meltdown: validation/building/sell-refunds-seventy-percent.test.ts is not implemented yet",
  );
});
