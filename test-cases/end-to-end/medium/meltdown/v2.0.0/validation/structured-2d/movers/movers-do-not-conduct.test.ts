// Meltdown — movers/movers-do-not-conduct: a mover conducts nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Two emitters at 90 and 10 touching the same Forge, and touching each other
//   nowhere, do not move toward one another.

import { it } from "vitest";

it("A mover conducts nothing", () => {
  throw new Error(
    "Meltdown: validation/movers/movers-do-not-conduct.test.ts is not implemented yet",
  );
});
