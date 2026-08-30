// Meltdown — combat/slow-stronger-replaces: a stronger slow takes over.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit carrying a 0.20 slow hit by a 0.55 slow reports slowFactor 0.55 and
//   slowTimer back at SLOW_TIME.

import { it } from "vitest";

it("A stronger slow takes over", () => {
  throw new Error(
    "Meltdown: validation/combat/slow-stronger-replaces.test.ts is not implemented yet",
  );
});
