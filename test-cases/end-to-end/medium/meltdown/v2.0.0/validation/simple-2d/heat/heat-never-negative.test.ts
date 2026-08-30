// Meltdown — heat/heat-never-negative: heat stops at zero.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower posed at 2 beside two level-III Sinks reports 0 after a second and
//   never a negative value.

import { it } from "vitest";

it("Heat stops at zero", () => {
  throw new Error(
    "Meltdown: validation/heat/heat-never-negative.test.ts is not implemented yet",
  );
});
