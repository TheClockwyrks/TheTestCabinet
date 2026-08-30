// Meltdown — instrumentation/unit-motion-gate-leaves-pathing: motion off
// leaves the unit's route live.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With motion off, a wall built across the unit's way raises its remaining
//   on the frame the wall lands.

import { it } from "vitest";

it("Motion off leaves the unit's route live", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/unit-motion-gate-leaves-pathing.test.ts is not implemented yet",
  );
});
