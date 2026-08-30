// Meltdown — mazing/diagonal-needs-both-neighbours: a diagonal never cuts a
// corner.
//
// SCAFFOLD. This validator has not been written yet. `test-case.toml`
// declares it, so the file must exist for the manifest to resolve, and it
// THROWS rather than passing so a stub nobody came back to fails loudly
// instead of silently scoring a point.
//
// What it must decide:
//
//   A unit offered only a diagonal between two diagonally-touching towers does
//   not take it, and its route length reflects going around.

import { it } from "vitest";

it("A diagonal never cuts a corner", () => {
  throw new Error(
    "Meltdown: validation/mazing/diagonal-needs-both-neighbours.test.ts is not implemented yet",
  );
});
