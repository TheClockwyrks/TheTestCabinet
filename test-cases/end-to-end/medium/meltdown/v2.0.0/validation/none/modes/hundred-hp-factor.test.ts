// Meltdown — modes/hundred-hp-factor: every unit is six times as tough.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Each unit reports maxHp of baseHp * 6.0 regardless of how far into the
//   onslaught it arrives.

import { it } from "vitest";

it("Every unit is six times as tough", () => {
  throw new Error(
    "Meltdown: validation/modes/hundred-hp-factor.test.ts is not implemented yet",
  );
});
