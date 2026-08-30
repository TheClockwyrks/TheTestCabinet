// Meltdown — instrumentation/tower-thermal-gate-leaves-the-guns: thermal off
// leaves the guns firing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower with thermal off and a target in range fires at its rate and deals
//   baseDamage * heatMultiplier(heat, redline) at the pinned heat.

import { it } from "vitest";

it("Thermal off leaves the guns firing", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/tower-thermal-gate-leaves-the-guns.test.ts is not implemented yet",
  );
});
