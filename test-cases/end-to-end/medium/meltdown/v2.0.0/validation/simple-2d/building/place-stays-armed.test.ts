// Meltdown — building/place-stays-armed: placement stays armed.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   After a successful place, build still carries the same type at the same
//   rotation, so a second copy drops without re-arming.

import { it } from "vitest";

it("Placement stays armed", () => {
  throw new Error(
    "Meltdown: validation/building/place-stays-armed.test.ts is not implemented yet",
  );
});
