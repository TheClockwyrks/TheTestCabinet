// Meltdown — combat/flak-ignores-ground: the Flak is air-only.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A Flak with only ground units in range reports firing false and deals no
//   damage over ten seconds.

import { it } from "vitest";

it("The Flak is air-only", () => {
  throw new Error(
    "Meltdown: validation/combat/flak-ignores-ground.test.ts is not implemented yet",
  );
});
