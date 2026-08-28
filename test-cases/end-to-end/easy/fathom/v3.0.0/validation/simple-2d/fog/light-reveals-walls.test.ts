// fog/light-reveals-walls — the light reveals the rock it lands on and stops there.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// A rock tile whose center is within V of the forager, with open water between
// them, reports visibility l, and the tile directly behind it on the same line
// stays u, so the light reaches the wall and no farther.

import { it } from "vitest";

it("The light reveals the rock it lands on and stops there", () => {
  throw new Error(
    "validation/simple-2d/fog/light-reveals-walls.test.ts: not implemented",
  );
});
