// Meltdown — heat/plateau-holds: the plateau holds to the trip.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   From the redline to heat 99 the multiplier holds flat at 3.5, so heat
//   above the redline buys no damage.

import { it } from "vitest";

it("The plateau holds to the trip", () => {
  throw new Error(
    "Meltdown: validation/heat/plateau-holds.test.ts is not implemented yet",
  );
});
