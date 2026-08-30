// Meltdown — instrumentation/clear-towers-pays-nothing: clearTowers pays no
// refund.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Clearing a floor of upgraded towers leaves money and score exactly as they
//   were.

import { it } from "vitest";

it("clearTowers pays no refund", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/clear-towers-pays-nothing.test.ts is not implemented yet",
  );
});
