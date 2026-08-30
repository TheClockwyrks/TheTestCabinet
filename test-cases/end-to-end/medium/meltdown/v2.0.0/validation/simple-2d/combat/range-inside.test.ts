// Meltdown — combat/range-inside: a unit inside the radius is targeted.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit at range * 19 logical units from the footprint centre is reported
//   as targeting.

import { it } from "vitest";

it("A unit inside the radius is targeted", () => {
  throw new Error(
    "Meltdown: validation/combat/range-inside.test.ts is not implemented yet",
  );
});
