// Meltdown — economy/interest-capped: interest is capped at 40.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With 10,000 on hand the payment is 40, not 800.

import { it } from "vitest";

it("Interest is capped at 40", () => {
  throw new Error(
    "Meltdown: validation/economy/interest-capped.test.ts is not implemented yet",
  );
});
