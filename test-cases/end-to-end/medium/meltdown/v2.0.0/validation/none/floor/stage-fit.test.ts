// Meltdown — floor/stage-fit: the whole stage stays visible and centred.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The full floor, the whole build panel and all four edges of the 1280x720
//   stage are visible, fitted and centred at three window sizes and two pixel
//   densities, including on load before any input.

import { it } from "vitest";

it("The whole stage stays visible and centred", () => {
  throw new Error(
    "Meltdown: validation/floor/stage-fit.test.ts is not implemented yet",
  );
});
