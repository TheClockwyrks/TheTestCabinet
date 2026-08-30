// Meltdown — instrumentation/reset-seeds-randomness: reset seeds the game's
// randomness.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Two waves released after reset({ seed: 7 }) draw the identical sequence of
//   vents, and a wave after reset({ seed: 8 }) draws a different one.

import { it } from "vitest";

it("reset seeds the game's randomness", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/reset-seeds-randomness.test.ts is not implemented yet",
  );
});
