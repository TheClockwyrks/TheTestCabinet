// Meltdown — presentation/surge-off-the-heat-axis: the surge never reads as
// heat.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Each surge type's colour is plainly distinct from every colour a tower
//   shows anywhere across its heat range, tripped included.

import { it } from "vitest";

it("The surge never reads as heat", () => {
  throw new Error(
    "Meltdown: validation/presentation/surge-off-the-heat-axis.test.ts is not implemented yet",
  );
});
