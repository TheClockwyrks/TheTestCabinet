// Meltdown — instrumentation/entity-ids: every entity carries a distinct,
// stable id.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Each tower and unit added takes an id distinct from every other live
//   entity's, appears last in its roster, and keeps that id across frames and
//   across other entities being removed.

import { it } from "vitest";

it("Every entity carries a distinct, stable id", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/entity-ids.test.ts is not implemented yet",
  );
});
