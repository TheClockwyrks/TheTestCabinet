// Meltdown — combat/slow-weaker-is-ignored: a weaker slow neither replaces nor
// refreshes.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit carrying a 0.55 slow hit by a 0.20 slow keeps slowFactor 0.55 and
//   keeps the slowTimer it had.

import { it } from "vitest";

it("A weaker slow neither replaces nor refreshes", () => {
  throw new Error(
    "Meltdown: validation/combat/slow-weaker-is-ignored.test.ts is not implemented yet",
  );
});
