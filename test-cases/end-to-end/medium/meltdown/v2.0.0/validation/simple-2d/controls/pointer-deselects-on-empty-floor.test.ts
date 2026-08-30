// Meltdown — controls/pointer-deselects-on-empty-floor: tapping empty floor
// deselects.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tap on open floor with a tower selected and nothing armed clears
//   selected.

import { it } from "vitest";

it("Tapping empty floor deselects", () => {
  throw new Error(
    "Meltdown: validation/controls/pointer-deselects-on-empty-floor.test.ts is not implemented yet",
  );
});
