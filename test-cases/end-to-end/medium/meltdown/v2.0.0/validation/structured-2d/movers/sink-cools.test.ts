// Meltdown — movers/sink-cools: the Sink drains a hot gun.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A level-I Sink touching an emitter removes exactly 16 * sharedEdges *
//   (heat / 100) per second, divided by that emitter's mass.

import { it } from "vitest";

it("The Sink drains a hot gun", () => {
  throw new Error(
    "Meltdown: validation/movers/sink-cools.test.ts is not implemented yet",
  );
});
