// Meltdown — floor/casing-impassable: the casing cannot be crossed.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Over a minute of walking, no unit's centre ever leaves the floor rectangle
//   except through an opening.

import { it } from "vitest";

it("The casing cannot be crossed", () => {
  throw new Error(
    "Meltdown: validation/floor/casing-impassable.test.ts is not implemented yet",
  );
});
