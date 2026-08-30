// Meltdown — heat/readouts-derived: the reported multiplier and damage follow
// the heat.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   At five heats the snapshot's heatMult equals heatMultiplier(heat, redline)
//   and its damage equals baseDamage(level) * heatMult.

import { it } from "vitest";

it("The reported multiplier and damage follow the heat", () => {
  throw new Error(
    "Meltdown: validation/heat/readouts-derived.test.ts is not implemented yet",
  );
});
