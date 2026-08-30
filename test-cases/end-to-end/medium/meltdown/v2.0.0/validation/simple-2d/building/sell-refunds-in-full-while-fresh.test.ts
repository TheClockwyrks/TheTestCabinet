// Meltdown — building/sell-refunds-in-full-while-fresh: a tower that never
// fought refunds in full.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower placed this build phase, before the wave starts, refunds its whole
//   spend with no rounding loss.

import { it } from "vitest";

it("A tower that never fought refunds in full", () => {
  throw new Error(
    "Meltdown: validation/building/sell-refunds-in-full-while-fresh.test.ts is not implemented yet",
  );
});
