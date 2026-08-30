// Meltdown — instrumentation/wave-spawning-gate-holds-auto-start: wave
// spawning off holds the auto-start.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With the gate off, a build timer driven to 0 leaves the phase building and
//   the timer at 0; with it on, the phase becomes wave.

import { it } from "vitest";

it("Wave spawning off holds the auto-start", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/wave-spawning-gate-holds-auto-start.test.ts is not implemented yet",
  );
});
