// Meltdown — waves/a-leak-also-clears: a leaked last unit clears the wave too.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The same transition happens when the last unit leaks rather than dies.

import { it } from "vitest";

it("A leaked last unit clears the wave too", () => {
  throw new Error(
    "Meltdown: validation/waves/a-leak-also-clears.test.ts is not implemented yet",
  );
});
