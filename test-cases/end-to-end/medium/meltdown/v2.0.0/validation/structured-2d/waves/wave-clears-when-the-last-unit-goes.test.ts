// Meltdown — waves/wave-clears-when-the-last-unit-goes: a wave clears on its
// last unit.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With wavePending 0 and one live wave unit, that unit dying moves the phase
//   to building.

import { it } from "vitest";

it("A wave clears on its last unit", () => {
  throw new Error(
    "Meltdown: validation/waves/wave-clears-when-the-last-unit-goes.test.ts is not implemented yet",
  );
});
