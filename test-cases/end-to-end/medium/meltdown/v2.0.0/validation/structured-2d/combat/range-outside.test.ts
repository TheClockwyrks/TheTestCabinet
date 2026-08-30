// Meltdown — combat/range-outside: a unit outside the radius is not.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit one logical unit beyond that radius is not targeted and takes no
//   damage.

import { it } from "vitest";

it("A unit outside the radius is not", () => {
  throw new Error(
    "Meltdown: validation/combat/range-outside.test.ts is not implemented yet",
  );
});
