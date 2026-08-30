// Meltdown — instrumentation/wave-spawning-gate: wave spawning off keeps the
// run's surge away.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With the gate off, a wave phase with wavePending 30 releases no unit over
//   a minute of game time; with it on, the roster fills.

import { it } from "vitest";

it("Wave spawning off keeps the run's surge away", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/wave-spawning-gate.test.ts is not implemented yet",
  );
});
