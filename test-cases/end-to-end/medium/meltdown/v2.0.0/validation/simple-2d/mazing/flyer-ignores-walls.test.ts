// Meltdown — mazing/flyer-ignores-walls: a wall does not turn a flyer.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A full wall of towers across a Drift's line changes neither the path it
//   flies nor the time it takes to cross.

import { it } from "vitest";

it("A wall does not turn a flyer", () => {
  throw new Error(
    "Meltdown: validation/mazing/flyer-ignores-walls.test.ts is not implemented yet",
  );
});
