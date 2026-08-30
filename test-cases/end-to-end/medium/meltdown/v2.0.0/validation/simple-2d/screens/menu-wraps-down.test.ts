// Meltdown — screens/menu-wraps-down: the highlight wraps past the last row.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Moving down from the last row of a menu highlights the first.

import { it } from "vitest";

it("The highlight wraps past the last row", () => {
  throw new Error(
    "Meltdown: validation/screens/menu-wraps-down.test.ts is not implemented yet",
  );
});
