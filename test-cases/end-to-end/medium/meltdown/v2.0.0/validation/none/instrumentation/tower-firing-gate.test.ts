// Meltdown — instrumentation/tower-firing-gate: firing off holds a tower's
// guns.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With setTowerFiring(id, false) and a unit in range, the tower reports
//   firing false, fires no shot, deals no damage and gains no heat over a
//   second; with it on, all four change.

import { it } from "vitest";

it("Firing off holds a tower's guns", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/tower-firing-gate.test.ts is not implemented yet",
  );
});
