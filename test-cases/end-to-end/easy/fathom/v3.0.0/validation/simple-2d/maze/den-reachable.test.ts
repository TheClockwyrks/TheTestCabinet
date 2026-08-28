// maze/den-reachable — a released predator can reach the forager.
//
// NOT IMPLEMENTED. The checklist declares this point; the suite that decides it
// lands with the rest of this engine's validators. Until then it fails loudly
// rather than passing on nothing.
//
// The claim this validator has to decide:
// Following neighbors that are corridor, den-interior or den-gate tiles, the
// forager's start tile is reachable from every den-interior tile, so the den
// is not walled off from the maze it hunts in.

import { it } from "vitest";

it("A released predator can reach the forager", () => {
  throw new Error(
    "validation/simple-2d/maze/den-reachable.test.ts: not implemented",
  );
});
