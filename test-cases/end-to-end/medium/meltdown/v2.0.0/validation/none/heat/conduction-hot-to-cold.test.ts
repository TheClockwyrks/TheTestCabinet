// Meltdown — heat/conduction-hot-to-cold: heat conducts to a cooler neighbour.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Two touching emitters at 90 and 10 exchange exactly 3.5 * sharedEdges * 80
//   per second, divided by each one's mass.

import { it } from "vitest";

it("Heat conducts to a cooler neighbour", () => {
  throw new Error(
    "Meltdown: validation/heat/conduction-hot-to-cold.test.ts is not implemented yet",
  );
});
