// Meltdown — economy/bounty-not-paid-on-a-leak: a leak pays nothing.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit that reaches its exhaust adds nothing to money.

import { it } from "vitest";

it("A leak pays nothing", () => {
  throw new Error(
    "Meltdown: validation/economy/bounty-not-paid-on-a-leak.test.ts is not implemented yet",
  );
});
