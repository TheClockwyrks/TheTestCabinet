// Meltdown — instrumentation/remove-unit: removeUnit removes exactly one unit.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   removeUnit(id) removes that unit alone, leaves every other unit walking,
//   and costs no life and pays no bounty.

import { it } from "vitest";

it("removeUnit removes exactly one unit", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/remove-unit.test.ts is not implemented yet",
  );
});
