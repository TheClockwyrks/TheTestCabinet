// Meltdown — towers/mover-stats: the Forge and the Sink carry their stats.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Both cost 20 and are 2x2, both report an empty radiator-face list at every
//   rotation, and the Forge's level-I setpoint is 72 against the Sink's
//   level-I per-edge output of 16.

import { it } from "vitest";

it("The Forge and the Sink carry their stats", () => {
  throw new Error(
    "Meltdown: validation/towers/mover-stats.test.ts is not implemented yet",
  );
});
