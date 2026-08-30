// Meltdown — modes/containment-medium: medium opens with 250 and runs 20
// waves.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   startMoney 250, waveCount 20.

import { it } from "vitest";

it("Medium opens with 250 and runs 20 waves", () => {
  throw new Error(
    "Meltdown: validation/modes/containment-medium.test.ts is not implemented yet",
  );
});
