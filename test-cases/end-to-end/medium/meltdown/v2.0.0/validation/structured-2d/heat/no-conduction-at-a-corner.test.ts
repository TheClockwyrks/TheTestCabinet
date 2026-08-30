// Meltdown — heat/no-conduction-at-a-corner: a corner conducts nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Two emitters touching only at a corner share no edge and exchange nothing.

import { it } from "vitest";

it("A corner conducts nothing", () => {
  throw new Error(
    "Meltdown: validation/heat/no-conduction-at-a-corner.test.ts is not implemented yet",
  );
});
