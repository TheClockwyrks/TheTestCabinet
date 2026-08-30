// Meltdown — trip/tripped-takes-no-flow: a tripped tower takes part in no
// flow.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A tripped tower touching a hot emitter, a level-III Forge and a Sink still
//   bleeds at exactly 20 per second.

import { it } from "vitest";

it("A tripped tower takes part in no flow", () => {
  throw new Error(
    "Meltdown: validation/trip/tripped-takes-no-flow.test.ts is not implemented yet",
  );
});
