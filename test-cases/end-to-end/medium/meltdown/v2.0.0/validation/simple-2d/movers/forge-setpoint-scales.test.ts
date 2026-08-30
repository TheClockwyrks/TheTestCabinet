// Meltdown — movers/forge-setpoint-scales: the setpoint rises with the level.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   The setpoint is 72, 84 and 96 at levels I, II and III, and only a level-
//   III Forge drives a Lance past its 92 redline.

import { it } from "vitest";

it("The setpoint rises with the level", () => {
  throw new Error(
    "Meltdown: validation/movers/forge-setpoint-scales.test.ts is not implemented yet",
  );
});
