// Meltdown — instrumentation/add-tower-costs-nothing: addTower spends no money
// and runs no placement check.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   addTower leaves money unchanged and builds a tower on a footprint the
//   placement check would refuse for want of money, so a posed floor is never
//   limited by the economy.

import { it } from "vitest";

it("addTower spends no money and runs no placement check", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/add-tower-costs-nothing.test.ts is not implemented yet",
  );
});
