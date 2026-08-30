// Meltdown — economy/cannot-overspend-on-an-upgrade: an upgrade never
// overspends.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   An upgrade costing more than the money on hand changes nothing.

import { it } from "vitest";

it("An upgrade never overspends", () => {
  throw new Error(
    "Meltdown: validation/economy/cannot-overspend-on-an-upgrade.test.ts is not implemented yet",
  );
});
