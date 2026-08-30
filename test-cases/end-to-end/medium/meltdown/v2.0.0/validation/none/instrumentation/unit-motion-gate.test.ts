// Meltdown — instrumentation/unit-motion-gate: motion off holds a unit still.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With setUnitMotion(id, false) a unit reports the same centre after a
//   second of game time; with it on, it travels.

import { it } from "vitest";

it("Motion off holds a unit still", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/unit-motion-gate.test.ts is not implemented yet",
  );
});
