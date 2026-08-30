// Meltdown — controls/rotate-key-does-nothing-unarmed: r with nothing held
// changes nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   KeyR with no placement armed leaves every field of the snapshot as it was.

import { it } from "vitest";

it("R with nothing held changes nothing", () => {
  throw new Error(
    "Meltdown: validation/controls/rotate-key-does-nothing-unarmed.test.ts is not implemented yet",
  );
});
