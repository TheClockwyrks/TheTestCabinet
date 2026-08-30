// Meltdown — building/upgrade-leaves-the-geometry: an upgrade leaves size,
// redline, mass and radiators alone.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower upgraded to III reports the same size, redline, mass and radiator
//   faces it had at I.

import { it } from "vitest";

it("An upgrade leaves size, redline, mass and radiators alone", () => {
  throw new Error(
    "Meltdown: validation/building/upgrade-leaves-the-geometry.test.ts is not implemented yet",
  );
});
