// Meltdown — hud/on-floor-heat-read: each tower carries a heat read.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A placed tower draws a heat read on its footprint whose extent tracks its
//   heat, with a marker at its redline.

import { it } from "vitest";

it("Each tower carries a heat read", () => {
  throw new Error(
    "Meltdown: validation/hud/on-floor-heat-read.test.ts is not implemented yet",
  );
});
