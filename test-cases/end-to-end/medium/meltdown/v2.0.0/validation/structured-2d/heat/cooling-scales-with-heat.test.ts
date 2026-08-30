// Meltdown — heat/cooling-scales-with-heat: cooling is proportional to heat.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The same tower at heat 40 loses exactly half over one frame what it loses
//   at heat 80.

import { it } from "vitest";

it("Cooling is proportional to heat", () => {
  throw new Error(
    "Meltdown: validation/heat/cooling-scales-with-heat.test.ts is not implemented yet",
  );
});
