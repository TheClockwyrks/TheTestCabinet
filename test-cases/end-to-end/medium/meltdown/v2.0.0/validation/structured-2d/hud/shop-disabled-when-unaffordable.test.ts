// Meltdown — hud/shop-disabled-when-unaffordable: an unaffordable entry is
// drawn disabled.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With money below a type's cost, that entry is drawn plainly apart from an
//   affordable one.

import { it } from "vitest";

it("An unaffordable entry is drawn disabled", () => {
  throw new Error(
    "Meltdown: validation/hud/shop-disabled-when-unaffordable.test.ts is not implemented yet",
  );
});
