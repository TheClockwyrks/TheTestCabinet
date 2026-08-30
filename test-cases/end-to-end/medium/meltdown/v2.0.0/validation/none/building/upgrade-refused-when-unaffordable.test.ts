// Meltdown — building/upgrade-refused-when-unaffordable: an unaffordable
// upgrade changes nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With money one below the cost, the level, the stats and the money are all
//   unchanged.

import { it } from "vitest";

it("An unaffordable upgrade changes nothing", () => {
  throw new Error(
    "Meltdown: validation/building/upgrade-refused-when-unaffordable.test.ts is not implemented yet",
  );
});
