// Meltdown — building/upgrade-stops-at-three: level III is the ceiling.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A level III tower does not upgrade and reports upgradeCost 0.

import { it } from "vitest";

it("Level III is the ceiling", () => {
  throw new Error(
    "Meltdown: validation/building/upgrade-stops-at-three.test.ts is not implemented yet",
  );
});
