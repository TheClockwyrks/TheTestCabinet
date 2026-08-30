// Meltdown — instrumentation/clear-towers: clearTowers empties the towers
// alone.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   clearTowers() removes every tower, reopens every footprint, recomputes the
//   routes, and leaves the surge standing.

import { it } from "vitest";

it("clearTowers empties the towers alone", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/clear-towers.test.ts is not implemented yet",
  );
});
