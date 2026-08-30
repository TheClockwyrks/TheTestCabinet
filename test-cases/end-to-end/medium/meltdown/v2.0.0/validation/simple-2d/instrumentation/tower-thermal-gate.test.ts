// Meltdown — instrumentation/tower-thermal-gate: thermal off pins a tower's
// heat.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   With setTowerThermal(id, false) a tower posed at 60 in open air, beside a
//   Forge and beside a Sink, reports 60 after a second; with it on, its heat
//   moves.

import { it } from "vitest";

it("Thermal off pins a tower's heat", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/tower-thermal-gate.test.ts is not implemented yet",
  );
});
