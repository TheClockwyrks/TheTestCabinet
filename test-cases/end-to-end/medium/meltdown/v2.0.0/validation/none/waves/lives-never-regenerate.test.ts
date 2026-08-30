// Meltdown — waves/lives-never-regenerate: lives never come back.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Over a full wave cleared without a leak, lives never rise.

import { it } from "vitest";

it("Lives never come back", () => {
  throw new Error(
    "Meltdown: validation/waves/lives-never-regenerate.test.ts is not implemented yet",
  );
});
