// Meltdown — heat/mass-divides-the-gain: mass divides the per-shot gain.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A Stutter (mass 0.5) gains twice the heat per unit of heatPerShot that an
//   Arc (mass 1.0) does.

import { it } from "vitest";

it("Mass divides the per-shot gain", () => {
  throw new Error(
    "Meltdown: validation/heat/mass-divides-the-gain.test.ts is not implemented yet",
  );
});
