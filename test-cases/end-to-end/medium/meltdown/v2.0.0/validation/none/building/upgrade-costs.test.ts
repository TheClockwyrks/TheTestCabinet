// Meltdown — building/upgrade-costs: upgrades cost their multiples.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Level II costs 1.0 times the build cost and level III 1.8 times, reported
//   as upgradeCost and deducted on the upgrade.

import { it } from "vitest";

it("Upgrades cost their multiples", () => {
  throw new Error(
    "Meltdown: validation/building/upgrade-costs.test.ts is not implemented yet",
  );
});
