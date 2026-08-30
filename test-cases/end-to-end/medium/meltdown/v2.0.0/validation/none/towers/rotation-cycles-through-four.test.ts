// Meltdown — towers/rotation-cycles-through-four: four rotations give four
// face sets.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   Rotations 0 through 3 of a Rime report the four expected world face sets,
//   and rotation 4 is not reachable.

import { it } from "vitest";

it("Four rotations give four face sets", () => {
  throw new Error(
    "Meltdown: validation/towers/rotation-cycles-through-four.test.ts is not implemented yet",
  );
});
