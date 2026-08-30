// Meltdown — instrumentation/clear-surge: clearSurge empties the surge alone.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   clearSurge() removes every unit and leaves the towers standing with their
//   heat, levels and tallies untouched.

import { it } from "vitest";

it("clearSurge empties the surge alone", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/clear-surge.test.ts is not implemented yet",
  );
});
