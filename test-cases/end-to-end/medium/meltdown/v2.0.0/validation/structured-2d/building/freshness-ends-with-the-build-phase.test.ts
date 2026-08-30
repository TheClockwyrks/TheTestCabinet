// Meltdown — building/freshness-ends-with-the-build-phase: freshness ends when
// the wave starts.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower placed in a build phase reports fresh false once the phase becomes
//   wave, reached through the real transition rather than by posing the phase.

import { it } from "vitest";

it("Freshness ends when the wave starts", () => {
  throw new Error(
    "Meltdown: validation/building/freshness-ends-with-the-build-phase.test.ts is not implemented yet",
  );
});
