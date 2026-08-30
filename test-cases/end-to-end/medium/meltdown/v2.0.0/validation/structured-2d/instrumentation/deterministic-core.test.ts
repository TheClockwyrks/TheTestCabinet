// Meltdown — instrumentation/deterministic-core: the simulation advances on
// elapsed time alone.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   One second of game time covered as one frame and as 120 frames adds 1.0 to
//   simTime either way and leaves a unit walking an open row at the same
//   position, so the simulation reads nothing from the renderer.

import { it } from "vitest";

it("The simulation advances on elapsed time alone", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/deterministic-core.test.ts is not implemented yet",
  );
});
