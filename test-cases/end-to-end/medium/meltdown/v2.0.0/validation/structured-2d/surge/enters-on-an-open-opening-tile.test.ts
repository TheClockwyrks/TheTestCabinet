// Meltdown — surge/enters-on-an-open-opening-tile: a unit never appears inside
// a tower.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With three of an opening's four edge tiles walled, every unit that vent
//   releases appears on the fourth.

import { it } from "vitest";

it("A unit never appears inside a tower", () => {
  throw new Error(
    "Meltdown: validation/surge/enters-on-an-open-opening-tile.test.ts is not implemented yet",
  );
});
