// Meltdown — modes/difficulty-changes-nothing-else: a difficulty changes only
// two figures.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   startLives is 20, interest is true, buildZone is null and the HP scaling
//   is the same at all three.

import { it } from "vitest";

it("A difficulty changes only two figures", () => {
  throw new Error(
    "Meltdown: validation/modes/difficulty-changes-nothing-else.test.ts is not implemented yet",
  );
});
