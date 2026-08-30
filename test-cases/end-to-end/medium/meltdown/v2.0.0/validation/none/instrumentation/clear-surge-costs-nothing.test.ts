// Meltdown — instrumentation/clear-surge-costs-nothing: clearSurge costs no
// life and pays no bounty.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Clearing a floor of walking units leaves lives, money and score exactly as
//   they were.

import { it } from "vitest";

it("clearSurge costs no life and pays no bounty", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/clear-surge-costs-nothing.test.ts is not implemented yet",
  );
});
