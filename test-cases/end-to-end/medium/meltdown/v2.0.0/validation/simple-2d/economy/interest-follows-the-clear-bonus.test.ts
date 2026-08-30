// Meltdown — economy/interest-follows-the-clear-bonus: interest is computed
// after the clear bonus.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   On the same transition the clear bonus lands first and the interest is 8%
//   of the money it left.

import { it } from "vitest";

it("Interest is computed after the clear bonus", () => {
  throw new Error(
    "Meltdown: validation/economy/interest-follows-the-clear-bonus.test.ts is not implemented yet",
  );
});
