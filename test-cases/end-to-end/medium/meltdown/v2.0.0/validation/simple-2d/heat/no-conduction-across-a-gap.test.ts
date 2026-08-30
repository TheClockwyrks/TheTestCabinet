// Meltdown — heat/no-conduction-across-a-gap: a gap conducts nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Two emitters one tile apart exchange nothing.

import { it } from "vitest";

it("A gap conducts nothing", () => {
  throw new Error(
    "Meltdown: validation/heat/no-conduction-across-a-gap.test.ts is not implemented yet",
  );
});
