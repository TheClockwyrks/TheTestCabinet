// Meltdown — movers/forge-warms: the Forge warms a cold gun.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A level-I Forge touching a cold Arc adds exactly 0.9 * sharedEdges * (72 -
//   heat) per second, divided by the Arc's mass.

import { it } from "vitest";

it("The Forge warms a cold gun", () => {
  throw new Error(
    "Meltdown: validation/movers/forge-warms.test.ts is not implemented yet",
  );
});
