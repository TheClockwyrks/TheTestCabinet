// Meltdown — instrumentation/tower-firing-gate-leaves-the-thermal-model:
// firing off leaves the heat model running.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tower with firing off, posed at heat 60 in open air, cools over a second
//   by exactly what an idle tower of the same layout cools by.

import { it } from "vitest";

it("Firing off leaves the heat model running", () => {
  throw new Error(
    "Meltdown: validation/instrumentation/tower-firing-gate-leaves-the-thermal-model.test.ts is not implemented yet",
  );
});
