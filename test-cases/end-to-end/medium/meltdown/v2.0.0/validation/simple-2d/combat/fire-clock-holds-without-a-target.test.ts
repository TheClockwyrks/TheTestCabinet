// Meltdown — combat/fire-clock-holds-without-a-target: the fire clock waits
// for a target.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower left idle for ten seconds and then given a target still lands its
//   first shot one full interval later, not immediately.

import { it } from "vitest";

it("The fire clock waits for a target", () => {
  throw new Error(
    "Meltdown: validation/combat/fire-clock-holds-without-a-target.test.ts is not implemented yet",
  );
});
