// Meltdown — heat/air-cooling-rate: open faces shed at the stated rate.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A lone Arc at heat 80 with firing off loses exactly (3.6 * 4 + 1.1 * 4) *
//   0.80 per second over one frame, its four radiator edge-tiles and four
//   plain ones all on open air. It is posed at 80 rather than 100 so no
//   reading of the trip boundary can change the answer.

import { it } from "vitest";

it("Open faces shed at the stated rate", () => {
  throw new Error(
    "Meltdown: validation/heat/air-cooling-rate.test.ts is not implemented yet",
  );
});
