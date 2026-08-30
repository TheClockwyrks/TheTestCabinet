// Meltdown — trip/posed-at-100-and-cooling-does-not-trip: sitting at 100 is
// not itself a trip.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower posed at heat 100 with firing off, whose next frame resolves it
//   below 100, reports tripped false: the trip is the crossing, not the value.

import { it } from "vitest";

it("Sitting at 100 is not itself a trip", () => {
  throw new Error(
    "Meltdown: validation/trip/posed-at-100-and-cooling-does-not-trip.test.ts is not implemented yet",
  );
});
